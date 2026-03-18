const jwt = require('jsonwebtoken');
const { runQuery } = require('../utils/eduSchema');
const { getJwtSecret, hashIpForLogs } = require('../utils/security');

const JWT_SECRET = getJwtSecret();

async function eduAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const hasAuthHeader = Boolean(header);
  const ipHash = hashIpForLogs(req.ip);

  console.log('AUTH CHECK:', {
    method: req.method,
    path: req.originalUrl,
    hasAuthorizationHeader: hasAuthHeader,
    ipHash,
  });

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token is required' });
  }

  const token = header.slice(7).trim();

  if (!token) {
    return res.status(401).json({ message: 'Authorization token is required' });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, JWT_SECRET);
    console.log('AUTH TOKEN VERIFY: success', {
      method: req.method,
      path: req.originalUrl,
      userId: decoded?.id || null,
      role: decoded?.role || null,
      ipHash,
    });
  } catch (error) {
    console.warn('AUTH TOKEN VERIFY: failed', {
      method: req.method,
      path: req.originalUrl,
      errorName: error.name,
      ipHash,
    });
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  if (!decoded || !decoded.id) {
    console.warn('AUTH TOKEN PAYLOAD INVALID:', {
      method: req.method,
      path: req.originalUrl,
      hasDecodedPayload: Boolean(decoded),
      ipHash,
    });
    return res.status(401).json({ message: 'Invalid authentication payload' });
  }

  try {
    const users = await runQuery(
      'SELECT id, name, email, role, department, institution, profile_pic_url FROM edu_users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (!users.length) {
      console.warn('AUTH USER LOOKUP: not found', {
        method: req.method,
        path: req.originalUrl,
        tokenUserId: decoded.id,
        ipHash,
      });
      return res.status(404).json({ message: 'Authenticated user not found' });
    }

    const user = users[0];
    req.user = {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      institution: user.institution,
      profile_pic_url: user.profile_pic_url,
    };

    console.log('AUTH USER LOOKUP: success', {
      method: req.method,
      path: req.originalUrl,
      userId: req.user.id,
      role: req.user.role,
      ipHash,
    });

    return next();
  } catch (error) {
    console.error('AUTH USER LOOKUP: failed', {
      method: req.method,
      path: req.originalUrl,
      tokenUserId: decoded.id,
      code: error.code,
      errno: error.errno,
      ipHash,
    });
    return res.status(500).json({ message: 'Authentication lookup failed' });
  }
}

module.exports = eduAuthMiddleware;

