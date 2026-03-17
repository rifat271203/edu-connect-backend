const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');

const router = express.Router();

function safeErrorResponse(res, status, message, error, context = {}) {
  console.error('EDU AUTH ERROR:', {
    ...context,
    status,
    message,
    errorMessage: error?.message,
    code: error?.code,
    errno: error?.errno,
  });
  return res.status(status).json({ message });
}

function wrapAsync(routeName, handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error('UNHANDLED EDU AUTH ROUTE ERROR:', {
        routeName,
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id || null,
        message: error.message,
        stack: error.stack,
      });
      next(error);
    }
  };
}

router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    next();
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to initialize edu schema', error, {
      routeName: 'router.use.ensureEduSchema',
      method: req.method,
      path: req.originalUrl,
    });
  }
});

function signEduToken(user) {
  if (!user || !user.id || !user.email) {
    throw new Error('Cannot sign token for invalid user payload');
  }

  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET || 'default_secret_key',
    { expiresIn: '1h' }
  );
}

async function registerByRole(req, res, role) {
  const { name, email, password, department, institution } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email and password are required' });
  }

  try {
    const existing = await runQuery('SELECT id FROM edu_users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertResult = await runQuery(
      `INSERT INTO edu_users (name, email, password, role, department, institution)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, hashedPassword, role, department || null, institution || null]
    );

    const userId = insertResult.insertId;
    const userRows = await runQuery(
      'SELECT id, name, email, role, department, institution, profile_pic_url, is_profile_public, created_at FROM edu_users WHERE id = ?',
      [userId]
    );

    const user = userRows[0];
    if (!user) {
      return res.status(500).json({ message: 'User was created but could not be loaded' });
    }

    const token = signEduToken(user);

    return res.status(201).json({
      message: `${role} registered successfully`,
      token,
      user,
    });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Registration failed', error, {
      routeName: 'registerByRole',
      role,
      email,
    });
  }
}

async function loginByRole(req, res, role) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  try {
    const users = await runQuery('SELECT * FROM edu_users WHERE email = ? AND role = ?', [email, role]);
    if (!users.length) {
      return res.status(404).json({ message: `${role} account not found` });
    }

    const user = users[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = signEduToken(user);

    return res.json({
      message: `${role} login successful`,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        institution: user.institution,
        profile_pic_url: user.profile_pic_url,
        is_profile_public: Number(user.is_profile_public) === 1 ? 1 : 0,
      },
    });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Login failed', error, {
      routeName: 'loginByRole',
      role,
      email,
    });
  }
}

router.post('/teachers/register', wrapAsync('POST /teachers/register', async (req, res) => registerByRole(req, res, 'teacher')));
router.post('/students/register', wrapAsync('POST /students/register', async (req, res) => registerByRole(req, res, 'student')));

router.post('/teachers/login', wrapAsync('POST /teachers/login', async (req, res) => loginByRole(req, res, 'teacher')));
router.post('/students/login', wrapAsync('POST /students/login', async (req, res) => loginByRole(req, res, 'student')));

router.get('/me', eduAuthMiddleware, wrapAsync('GET /me', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: 'Unauthorized user context' });
  }

  try {
    const users = await runQuery(
      'SELECT id, name, email, role, department, institution, profile_pic_url, is_profile_public, created_at FROM edu_users WHERE id = ?',
      [req.user.id]
    );

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ user: users[0] });
  } catch (error) {
    return safeErrorResponse(res, 500, 'Failed to fetch profile', error, {
      routeName: 'GET /me',
      userId: req.user?.id || null,
    });
  }
}));

router.patch('/password', eduAuthMiddleware, wrapAsync('PATCH /password', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: 'Unauthorized user context' });
  }

  const currentPassword = (req.body.currentPassword || '').toString();
  const newPassword = (req.body.newPassword || '').toString();

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ message: 'newPassword must be different from currentPassword' });
  }

  const users = await runQuery('SELECT id, password FROM edu_users WHERE id = ? LIMIT 1', [req.user.id]);
  if (!users.length) {
    return res.status(404).json({ message: 'User not found' });
  }

  const user = users[0];
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password || '');
  if (!isCurrentPasswordValid) {
    return res.status(401).json({ message: 'Current password is incorrect' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await runQuery('UPDATE edu_users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

  return res.json({ message: 'Password updated successfully' });
}));

module.exports = router;

