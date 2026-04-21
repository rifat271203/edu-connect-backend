require('dotenv').config();
const mysql = require('mysql2');

const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_POOL_SIZE = Number(process.env.DB_POOL_SIZE || 10);
const DB_SSL_ENABLED = process.env.DB_SSL !== 'false';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number.isFinite(DB_POOL_SIZE) && DB_POOL_SIZE > 0 ? DB_POOL_SIZE : 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ssl: DB_SSL_ENABLED
    ? {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      }
    : undefined,
});

pool.on('connection', (connection) => {
  console.log(`Database pool connection established ✅ (thread ${connection.threadId})`);

  connection.on('error', (error) => {
    console.error('Database connection error:', {
      code: error.code,
      errno: error.errno,
      message: error.message,
      fatal: error.fatal,
    });
  });
});

pool.on('enqueue', () => {
  console.warn('Database pool is waiting for an available connection slot');
});

function query(sql, params, callback) {
  const hasParams = Array.isArray(params);
  const cb = typeof params === 'function' ? params : callback;
  const finalParams = hasParams ? params : [];

  if (typeof cb === 'function') {
    return pool.query(sql, finalParams, cb);
  }

  return new Promise((resolve, reject) => {
    pool.query(sql, finalParams, (error, results) => {
      if (error) return reject(error);
      return resolve(results);
    });
  });
}

async function ping() {
  const rows = await query('SELECT 1 AS ok');
  return rows;
}

function close() {
  return new Promise((resolve, reject) => {
    pool.end((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}

// Test database connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Database connection test failed:', err);
  } else {
    console.log('Database connection test succeeded ✅');
    connection.release();
  }
});

module.exports = {
  query,
  ping,
  close,
  pool,
};
