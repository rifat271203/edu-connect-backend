const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    next();
  } catch (error) {
    res.status(500).json({ message: 'Failed to initialize edu schema', error: error.message });
  }
});

function signEduToken(user) {
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
      'SELECT id, name, email, role, department, institution, profile_pic_url, created_at FROM edu_users WHERE id = ?',
      [userId]
    );

    const user = userRows[0];
    const token = signEduToken(user);

    return res.status(201).json({
      message: `${role} registered successfully`,
      token,
      user,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed', error: error.message });
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
      return res.status(400).json({ message: 'Incorrect password' });
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
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed', error: error.message });
  }
}

router.post('/teachers/register', async (req, res) => registerByRole(req, res, 'teacher'));
router.post('/students/register', async (req, res) => registerByRole(req, res, 'student'));

router.post('/teachers/login', async (req, res) => loginByRole(req, res, 'teacher'));
router.post('/students/login', async (req, res) => loginByRole(req, res, 'student'));

router.get('/me', eduAuthMiddleware, async (req, res) => {
  try {
    const users = await runQuery(
      'SELECT id, name, email, role, department, institution, profile_pic_url, created_at FROM edu_users WHERE id = ?',
      [req.user.id]
    );

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ user: users[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch profile', error: error.message });
  }
});

module.exports = router;

