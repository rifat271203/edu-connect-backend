const crypto = require('crypto');

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 60;
const SAFE_HOST_REGEX = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/;

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret || secret === 'default_secret_key') {
    throw new Error('JWT_SECRET must be set to a strong non-default value');
  }
  return secret;
}

function parseAllowedOrigins(rawOrigins) {
  return String(rawOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        return parsed.origin;
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function createCorsOriginDelegate(allowedOrigins) {
  const allowedSet = new Set((Array.isArray(allowedOrigins) ? allowedOrigins : []).map((o) => String(o).trim()));

  return (origin, callback) => {
    // Non-browser / same-origin requests may omit Origin header
    if (!origin) {
      return callback(null, true);
    }

    if (allowedSet.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin not allowed by CORS'));
  };
}

function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    return next();
  };
}

function isSafeHttpUrl(value, { allowRelative = false } = {}) {
  if (typeof value !== 'string') return false;
  const input = value.trim();
  if (!input) return false;

  if (allowRelative && input.startsWith('/')) {
    return !input.startsWith('//') && !/[\u0000-\u001f\u007f]/.test(input);
  }

  try {
    const parsed = new URL(input);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

function resolvePublicBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_API_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (envBase && isSafeHttpUrl(envBase)) {
    const parsed = new URL(envBase);
    const basePath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
    return `${parsed.origin}${basePath}`;
  }

  const host = String(req.get('host') || '').trim();
  if (!host || !SAFE_HOST_REGEX.test(host)) {
    return null;
  }

  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function buildPublicFileUrl(req, filePath) {
  const cleanPath = `/${String(filePath || '').replace(/^\/+/, '')}`;
  const base = resolvePublicBaseUrl(req);
  if (!base) return cleanPath;
  return `${base}${cleanPath}`;
}

function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_RATE_LIMIT_WINDOW_MS;
  const max = Number(options.max) > 0 ? Number(options.max) : DEFAULT_RATE_LIMIT_MAX;
  const keyGenerator =
    typeof options.keyGenerator === 'function'
      ? options.keyGenerator
      : (req) => `${req.ip || 'unknown'}:${req.path || 'unknown'}`;
  const message = options.message || 'Too many requests';
  const statusCode = Number(options.statusCode) || 429;

  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = String(keyGenerator(req));
    const bucket = buckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(Math.ceil((bucket.expiresAt - now) / 1000), 1);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(statusCode).json({ message });
    }

    return next();
  };
}

function hashIpForLogs(ip) {
  const raw = String(ip || 'unknown');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

module.exports = {
  getJwtSecret,
  parseAllowedOrigins,
  createCorsOriginDelegate,
  securityHeaders,
  isSafeHttpUrl,
  buildPublicFileUrl,
  createRateLimiter,
  hashIpForLogs,
};
