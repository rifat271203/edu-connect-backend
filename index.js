const db = require('./db');
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const http = require('http')
const { Server } = require('socket.io')
const { registerMeetingSignaling } = require('./sockets/meetingSignaling')
const { registerDMMessaging } = require('./sockets/dmMessaging')

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express()
const server = http.createServer(app)

const frontendOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const io = new Server(server, {
  cors: {
    origin: frontendOrigins.length === 1 ? frontendOrigins[0] : frontendOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

registerMeetingSignaling(io)
registerDMMessaging(io)
app.set('io', io)

app.use(cors({
  origin: frontendOrigins.length === 1 ? frontendOrigins[0] : frontendOrigins,
  credentials: true,
}))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// Mount AI RAG routes
app.use('/api/ai', require('./routes/ai'));
app.use('/api/auth', require('./routes/eduAuth'));
app.use('/api/social', require('./routes/eduSocial'));
app.use('/api/meetings', require('./routes/meetings'));

app.get('/', (req, res) => {
  res.send('Backend running 🚀')
})

app.get('/ping', (req, res) => {
  res.status(200).json({ ok: true, message: 'server alive' });
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await db.query('SELECT 1');
    res.json({ ok: true, result });
  } catch (err) {
    console.error('DB TEST ERROR:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// legacy health alias
app.get('/test-db', async (req, res) => {
  try {
    const result = await db.query('SELECT 1 + 1 AS result');
    res.json(result);
  } catch (err) {
    res.status(500).json(err);
  }
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    const sql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

    await db.query(sql, [name, email, hashedPassword]);
    res.json({ message: "User registered successfully" });
  } catch (error) {
    console.error('REGISTER ERROR:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
    });
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const sql = "SELECT * FROM users WHERE email = ?";
    const results = await db.query(sql, [email]);

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = results[0];
    if (!user.password) {
      return res.status(500).json({ message: 'User password hash is missing' });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      process.env.JWT_SECRET || 'default_secret_key',
      { expiresIn: '1h' }
    );

    res.json({ message: "Login successful", token, name: user.name });
  } catch (error) {
    console.error('LOGIN ERROR:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
    });
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

// --- Chat API (Groq) ---
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages
      })
    });

    const data = await response.json();
    
    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    res.json({ response: data.choices[0].message });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to get response from AI' });
  }
});

app.use((err, req, res, next) => {
  console.error('UNHANDLED EXPRESS ERROR:', {
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id || null,
    message: err?.message,
    code: err?.code,
    stack: err?.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err?.status || 500).json({
    message: err?.status ? err.message : 'Internal server error',
  });
});

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
