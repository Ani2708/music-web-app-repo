const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'music_system',
    password: 'Pasta2708',
    port: 5432
})

module.exports = pool;