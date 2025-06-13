const express = require('express');
const path = require('path');
const app = express();
const db = require('./db');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'backend', 'views'));
app.use(express.static(path.join(__dirname, 'backend', 'public')));
app.use(express.urlencoded({ extended: true }));

// Home page – show ALL songs

app.get('/', async (req, res) => {
  try {
    // Get all songs with artist info
    const songsResult = await db.query(`
      SELECT 
        s.song_id, 
        s.title, 
        s.upload_date,
        a.name AS artist_name,
        ar.album_name,
        g.genre_name
      FROM song s
      JOIN performed_by pb ON s.song_id = pb.song_id
      JOIN artist a ON pb.artist_id = a.artist_id
      LEFT JOIN album ar ON s.album_id = ar.album_id
      LEFT JOIN genre g ON s.genre_id = g.genre_id
      ORDER BY s.upload_date DESC
    `);

    // Get comments for ALL songs in one query (more efficient than N+1 queries)
    const commentsResult = await db.query(`
      SELECT 
        c.song_id,
        c.content, 
        c.timestamp, 
        u.username
      FROM comments c
      JOIN users u ON c.user_id = u.user_id
      ORDER BY c.timestamp DESC
    `);

    // Group comments by song_id
    const commentsBySong = {};
    commentsResult.rows.forEach(comment => {
      if (!commentsBySong[comment.song_id]) {
        commentsBySong[comment.song_id] = [];
      }
      commentsBySong[comment.song_id].push(comment);
    });

    // Attach comments to each song
    const songsWithComments = songsResult.rows.map(song => ({
      ...song,
      comments: commentsBySong[song.song_id] || []
    }));

    res.render('index', { 
      songs: songsWithComments,
      formatDate: (date) => new Date(date).toLocaleDateString() 
    });
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).send('Error loading songs');
  }
});

// Song detail (now redundant since homepage shows all data)
app.get('/song/:id', async (req, res) => {
  try {
    const songId = req.params.id;
    
    // Get song details
    const songResult = await db.query(`
      SELECT 
        s.title, 
        s.upload_date, 
        g.genre_name, 
        al.album_name, 
        u.username,
        ar.name AS artist_name
      FROM song s
      JOIN performed_by pb ON s.song_id = pb.song_id
      JOIN artist ar ON pb.artist_id = ar.artist_id
      LEFT JOIN genre g ON s.genre_id = g.genre_id
      LEFT JOIN album al ON s.album_id = al.album_id
      LEFT JOIN users u ON s.user_id = u.user_id
      WHERE s.song_id = $1
    `, [songId]);

    if (songResult.rows.length === 0) {
      return res.status(404).send('Song not found');
    }

    // Get comments for this song
    const commentsResult = await db.query(`
      SELECT 
        c.content, 
        c.timestamp, 
        u.username
      FROM comments c
      JOIN users u ON c.user_id = u.user_id
      WHERE c.song_id = $1
      ORDER BY c.timestamp DESC
    `, [songId]);

     res.render('song', {
      song: songResult.rows[0],
      comments: commentsResult.rows,
      isOwner: true, // TEMPORARY - replace with real auth check
      formatDate: (date) => new Date(date).toLocaleString()
    });
  } catch (err) {
    console.error('Error fetching song:', err);
    res.status(500).send('Error loading song details');
  }
});
app.get('/playlists', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.playlist_name, p.creation_date, u.username, p.user_id
      FROM playlist p
      JOIN users u ON p.user_id = u.user_id
      ORDER BY p.creation_date DESC
    `);
    res.render('playlists', { playlists: result.rows });
  } catch (err) {
    console.error('Error fetching playlists:', err);
    res.status(500).send('Error loading playlists');
  }
});
app.get('/playlists/:user_id/:name', async (req, res) => {
  const { user_id, name } = req.params;

  try {
    // Fetch playlist creator's username
    const userResult = await db.query(`SELECT username FROM users WHERE user_id = $1`, [user_id]);
    if (userResult.rows.length === 0) return res.status(404).send('User not found');

    // Fetch songs in the playlist
    const songsResult = await db.query(`
      SELECT s.song_id, s.title, a.name AS artist_name
      FROM contains c
      JOIN song s ON c.song_id = s.song_id
      JOIN performed_by pb ON s.song_id = pb.song_id
      JOIN artist a ON pb.artist_id = a.artist_id
      WHERE c.user_id = $1 AND c.playlist_name = $2
    `, [user_id, name]);

    res.render('playlist_songs', {
      playlist: { playlist_name: name, username: userResult.rows[0].username },
      songs: songsResult.rows
    });
  } catch (err) {
    console.error('Error fetching playlist songs:', err);
    res.status(500).send('Error loading playlist songs');
  }
});
app.get('/artist/:id', async (req, res) => {
  try {
    const artistId = req.params.id;
    
    // Get artist info
    const artistResult = await db.query(`
      SELECT name, bio FROM artist WHERE artist_id = $1
    `, [artistId]);

    if (artistResult.rows.length === 0) {
      return res.status(404).send('Artist not found');
    }

    // Get all songs by this artist
    const songsResult = await db.query(`
      SELECT 
        s.song_id, 
        s.title,
        s.upload_date,
        g.genre_name,
        al.album_name
      FROM song s
      JOIN performed_by pb ON s.song_id = pb.song_id
      JOIN artist a ON pb.artist_id = a.artist_id
      LEFT JOIN genre g ON s.genre_id = g.genre_id
      LEFT JOIN album al ON s.album_id = al.album_id
      WHERE a.artist_id = $1
      ORDER BY s.upload_date DESC
    `, [artistId]);

    res.render('artist', {
      artist: artistResult.rows[0],
      songs: songsResult.rows,
      formatDate: (date) => new Date(date).toLocaleDateString()
    });
  } catch (err) {
    console.error('Error fetching artist:', err);
    res.status(500).send('Error loading artist page');
  }
});
app.post('/song/:id/delete', async (req, res) => {
  try {
    // First delete related records
    await db.query('DELETE FROM comments WHERE song_id = $1', [req.params.id]);
    await db.query('DELETE FROM contains WHERE song_id = $1', [req.params.id]);
    await db.query('DELETE FROM performed_by WHERE song_id = $1', [req.params.id]);
    
    // Then delete the song
    await db.query('DELETE FROM songs WHERE song_id = $1', [req.params.id]);
    
    res.redirect('/');
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).send('Error deleting song');
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));