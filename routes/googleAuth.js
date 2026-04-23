const express = require('express');
const jwt = require('jsonwebtoken');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');
const { getJwtSecret } = require('../utils/security');

const router = express.Router();
const jwtSecret = getJwtSecret();

// ─── Helpers ──────────────────────────────────────────────────────

function getGoogleConfig() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || '').trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

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
    jwtSecret,
    { expiresIn: '1h' }
  );
}

function encodeState(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeState(state) {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department || null,
    institution: user.institution || null,
    profile_pic_url: user.profile_pic_url || null,
    is_profile_public: Number(user.is_profile_public) === 1 ? 1 : 0,
  };
}

// Ensure the edu schema is ready before handling any request
router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    next();
  } catch (error) {
    console.error('GOOGLE AUTH: schema init failed', { message: error.message });
    res.status(500).json({ message: 'Service temporarily unavailable' });
  }
});

// ─── GET /initiate ────────────────────────────────────────────────
// Returns the Google OAuth consent URL for the frontend to redirect to.
//
// Query params:
//   role  — "student" | "teacher"  (defaults to "student")
//
// Response 200:
//   { url: "https://accounts.google.com/o/oauth2/v2/auth?..." }
// ──────────────────────────────────────────────────────────────────

router.get('/initiate', (req, res) => {
  const google = getGoogleConfig();

  if (!google) {
    return res.status(503).json({ message: 'Google OAuth is not configured on this server' });
  }

  const role = req.query.role === 'teacher' ? 'teacher' : 'student';
  const state = encodeState({ role });

  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state,
    prompt: 'select_account',
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return res.json({ url });
});

// ─── POST /callback ───────────────────────────────────────────────
// Exchanges the authorization code from Google for user info,
// creates or finds the user in the DB, and returns a JWT.
//
// Request body:
//   { code: string, state?: string }
//
// Response 200:
//   { token, user, is_new_user }
// ──────────────────────────────────────────────────────────────────

router.post('/callback', async (req, res) => {
  const google = getGoogleConfig();

  if (!google) {
    return res.status(503).json({ message: 'Google OAuth is not configured on this server' });
  }

  const { code, state } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ message: 'Authorization code is required' });
  }

  // Decode role from state (defaults to student)
  let role = 'student';
  if (state) {
    const decoded = decodeState(state);
    if (decoded && (decoded.role === 'teacher' || decoded.role === 'student')) {
      role = decoded.role;
    }
  }

  try {
    // ── Step 1: Exchange the authorization code for tokens ──
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: google.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('GOOGLE AUTH: token exchange failed', {
        error: tokenData.error,
        description: tokenData.error_description,
      });
      return res.status(401).json({
        message: 'Failed to authenticate with Google',
        error: tokenData.error_description || tokenData.error,
      });
    }

    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(401).json({ message: 'Google did not return an access token' });
    }

    // ── Step 2: Get the user's Google profile ──
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profile = await profileResponse.json();

    if (!profile.email) {
      return res.status(401).json({ message: 'Could not retrieve email from Google' });
    }

    const googleId = profile.id;
    const email = profile.email.trim().toLowerCase();
    const name = profile.name || email.split('@')[0];
    const picture = profile.picture || null;

    // ── Step 3: Find or create the user ──
    let isNewUser = false;
    let user;

    // First try to find by google_id
    const byGoogleId = await runQuery(
      'SELECT * FROM edu_users WHERE google_id = ? LIMIT 1',
      [googleId]
    );

    if (byGoogleId.length) {
      user = byGoogleId[0];

      // Update profile picture from Google if it changed
      if (picture && user.profile_pic_url !== picture) {
        await runQuery(
          'UPDATE edu_users SET profile_pic_url = ? WHERE id = ?',
          [picture, user.id]
        );
        user.profile_pic_url = picture;
      }
    } else {
      // Try to find by email
      const byEmail = await runQuery(
        'SELECT * FROM edu_users WHERE email = ? LIMIT 1',
        [email]
      );

      if (byEmail.length) {
        user = byEmail[0];

        // Link this Google account to the existing user
        await runQuery(
          'UPDATE edu_users SET google_id = ? WHERE id = ?',
          [googleId, user.id]
        );

        // Update profile picture if they don't have one
        if (picture && !user.profile_pic_url) {
          await runQuery(
            'UPDATE edu_users SET profile_pic_url = ? WHERE id = ?',
            [picture, user.id]
          );
          user.profile_pic_url = picture;
        }
      } else {
        // Create a new user (no password — Google-only auth)
        isNewUser = true;

        const insertResult = await runQuery(
          `INSERT INTO edu_users (name, email, password, role, google_id, profile_pic_url)
           VALUES (?, ?, NULL, ?, ?, ?)`,
          [name, email, role, googleId, picture]
        );

        const newUserRows = await runQuery(
          'SELECT * FROM edu_users WHERE id = ? LIMIT 1',
          [insertResult.insertId]
        );

        if (!newUserRows.length) {
          return res.status(500).json({ message: 'User was created but could not be loaded' });
        }

        user = newUserRows[0];
      }
    }

    // ── Step 4: Sign a JWT and respond ──
    const token = signEduToken(user);

    return res.json({
      message: 'Google authentication successful',
      token,
      user: sanitizeUser(user),
      is_new_user: isNewUser,
    });
  } catch (error) {
    console.error('GOOGLE AUTH CALLBACK ERROR:', {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ message: 'Google authentication failed' });
  }
});

module.exports = router;
