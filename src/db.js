const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '271203',
  database: 'myapp'
});

connection.connect((err) => {
  if (err) {
    console.log('Database connection failed ❌');
  } else {
    console.log('Database connected ✅');
  }
});

module.exports = connection;