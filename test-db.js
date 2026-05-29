const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_TYI0uJvWK5DN@ep-silent-tree-aqhupwsi-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => {
        console.log('✅ DATABASE CONNECTED!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ ERROR:', err.message);
        process.exit(1);
    });