const db = require('./db');
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const http = require('http')
const { Server } = require('socket.io')
const { registerMeetingSignaling } = require('./sockets/meetingSignaling')
const { registerDMMessaging } = require('./sockets/dmMessaging')
const {
  getJwtSecret,
  parseAllowedOrigins,
  createCorsOriginDelegate,
  securityHeaders,
  createRateLimiter,
} = require('./utils/security')

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express()
const server = http.createServer(app)

const jwtSecret = getJwtSecret()
const frontendOrigins = parseAllowedOrigins(process.env.FRONTEND_ORIGIN || process.env.ALLOWED_ORIGINS)

if (!frontendOrigins.length) {
  throw new Error('No valid FRONTEND_ORIGIN/ALLOWED_ORIGINS configured for CORS')
}

const corsOriginDelegate = createCorsOriginDelegate(frontendOrigins)

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

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(securityHeaders())

app.use((req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object' && !Array.isArray(body)) {
      const sanitized = { ...body }
      delete sanitized.error
      delete sanitized.details
      delete sanitized.stack
      delete sanitized.sql
      delete sanitized.sqlMessage

      if (Object.keys(sanitized).length === 0) {
        return originalJson({ message: 'Internal server error' })
      }

      if (!sanitized.message) {
        sanitized.message = 'Internal server error'
      }

      return originalJson(sanitized)
    }

    return originalJson(body)
  }

  return next()
})

app.use(cors({
  origin: corsOriginDelegate,
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(createRateLimiter({ windowMs: 60 * 1000, max: 120, message: 'Too many requests from this IP' }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 25, message: 'Too many auth attempts' })
const chatRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40, message: 'Too many chat requests' })
const aiRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 45, message: 'Too many AI requests' })
const legacyAuthRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many authentication attempts' })

// Mount AI RAG routes
app.use('/api/ai', aiRateLimiter, require('./routes/ai'));
app.use('/api/auth', authRateLimiter, require('./routes/eduAuth'));
app.use('/api/social', require('./routes/eduSocial'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/classroom', require('./src/modules/eduConnectClassroom'));

app.get('/', (req, res) => {
  res.status(200).json({ ok: true, message: 'Backend running' })
})

app.get('/ping', (req, res) => {
  res.status(200).json({ ok: true, message: 'server alive' });
});

app.get('/db-test', async (req, res) => {
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }

  try {
    const result = await db.query('SELECT 1');
    res.json({ ok: true, result });
  } catch (err) {
    console.error('DB TEST ERROR:', err);
    res.status(500).json({ ok: false, error: 'Database test failed' });
  }
});

// legacy health alias
app.get('/test-db', async (req, res) => {
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }

  try {
    const result = await db.query('SELECT 1 + 1 AS result');
    res.json(result);
  } catch (err) {
    console.error('LEGACY DB TEST ERROR:', err);
    res.status(500).json({ message: 'Database test failed' });
  }
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

app.post('/api/register', legacyAuthRateLimiter, async (req, res) => {
  if (process.env.ENABLE_LEGACY_AUTH_ENDPOINTS !== 'true') {
    return res.status(404).json({ message: 'Not found' })
  }

  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields required" });
  }

  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
    return res.status(400).json({ message: 'name must be 2-120 characters' });
  }

  if (typeof email !== 'string' || email.trim().length > 190) {
    return res.status(400).json({ message: 'email is invalid' });
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'password must be 8-128 characters' });
  }

  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (existing.length) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    const sql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

    await db.query(sql, [normalizedName, normalizedEmail, hashedPassword]);
    res.json({ message: "User registered successfully" });
  } catch (error) {
    console.error('REGISTER ERROR:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
    });
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/login', legacyAuthRateLimiter, async (req, res) => {
  if (process.env.ENABLE_LEGACY_AUTH_ENDPOINTS !== 'true') {
    return res.status(404).json({ message: 'Not found' })
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (typeof email !== 'string' || email.trim().length > 190) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const sql = "SELECT * FROM users WHERE email = ?";
    const results = await db.query(sql, [normalizedEmail]);

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
      jwtSecret,
      { expiresIn: '1h' }
    );

    res.json({ message: "Login successful", token, name: user.name });
  } catch (error) {
    console.error('LOGIN ERROR:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
    });
    res.status(500).json({ message: 'Login failed' });
  }
});

// --- Chat API (Groq) ---
app.post('/api/chat', chatRateLimiter, async (req, res) => {
  if (process.env.GROQ_API_KEY === undefined || String(process.env.GROQ_API_KEY).trim().length === 0) {
    return res.status(503).json({ error: 'AI provider is not configured' })
  }

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

    if (!data?.choices?.[0]?.message) {
      return res.status(502).json({ error: 'Invalid AI provider response' });
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

async function mountWebRtcFeatures() {
  const [socketModule, workerModule, authModule, sessionModule] = await Promise.all([
    import('./src/socket/index.ts'),
    import('./src/sfu/worker.ts'),
    import('./src/routes/auth.ts'),
    import('./src/routes/sessions.ts'),
  ]);

  const pickFn = (mod, keys) => {
    const queue = [mod];
    const seen = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);

      for (const key of keys) {
        const candidate = current[key];
        if (typeof candidate === 'function') return candidate;
      }

      if (current.default) queue.push(current.default);
      if (current.__esModule && current.default) queue.push(current.default);
    }

    return null;
  };

  const pickRouter = (mod, keys) => {
    const queue = [mod];
    const seen = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);

      for (const key of keys) {
        const candidate = current[key];
        if (candidate && typeof candidate === 'function' && typeof candidate.use === 'function') {
          return candidate;
        }
      }

      if (current.default) queue.push(current.default);
      if (current.__esModule && current.default) queue.push(current.default);
    }

    return null;
  };

  const initSocket = pickFn(socketModule, ['initSocket']);
  const initWorkers = pickFn(workerModule, ['initWorkers']);
  const authRouter = pickRouter(authModule, ['authRouter', 'default']);
  const sessionRouter = pickRouter(sessionModule, ['sessionRouter', 'default']);

  if (typeof initSocket !== 'function') {
    throw new Error('initSocket export was not found in ./src/socket/index.ts');
  }

  if (typeof initWorkers !== 'function') {
    throw new Error('initWorkers export was not found in ./src/sfu/worker.ts');
  }

  if (!authRouter || !sessionRouter) {
    throw new Error('Route exports were not found for auth/session routers');
  }

  await initWorkers();
  initSocket(io);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/sessions', sessionRouter);
}

;(async () => {
  try {
    await mountWebRtcFeatures();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (error) {
    console.error('WEBRTC BOOTSTRAP FAILED:', error)
    process.exit(1)
  }
})()
