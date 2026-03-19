const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { validationResult } = require('express-validator');
const { buildPublicFileUrl } = require('../../../../utils/security');

const CLASSROOM_UPLOAD_DIR = path.join(__dirname, '..', '..', '..', '..', 'uploads', 'classroom');

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function sendSuccess(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function sendError(res, statusCode, message, error) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: error || null,
  });
}

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return sendError(
    res,
    400,
    'Validation failed',
    errors
      .array()
      .map((item) => item.msg)
      .join(', ')
  );
}

function getPageLimit(query = {}, defaults = {}) {
  const fallbackPage = Number(defaults.page || 1);
  const fallbackLimit = Number(defaults.limit || 20);
  const maxLimit = Number(defaults.maxLimit || 100);

  const page = Number.parseInt(query.page, 10);
  const limit = Number.parseInt(query.limit, 10);

  const safePage = Number.isInteger(page) && page > 0 ? page : fallbackPage;
  const safeLimitRaw = Number.isInteger(limit) && limit > 0 ? limit : fallbackLimit;
  const safeLimit = Math.min(safeLimitRaw, maxLimit);

  return { page: safePage, limit: safeLimit };
}

function buildPagination({ page, limit, total }) {
  const safeTotal = Number(total || 0);
  const totalPages = Math.max(Math.ceil(safeTotal / limit), 1);
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
  };
}

function createUploadMiddleware({
  fieldName,
  maxSizeBytes = 50 * 1024 * 1024,
  allowedMimeTypes = null,
}) {
  const storage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.ensureDir(CLASSROOM_UPLOAD_DIR);
        cb(null, CLASSROOM_UPLOAD_DIR);
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '';
      cb(null, `classroom-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  });

  const uploader = multer({
    storage,
    limits: {
      fileSize: maxSizeBytes,
    },
    fileFilter: (_req, file, cb) => {
      if (Array.isArray(allowedMimeTypes) && allowedMimeTypes.length) {
        if (!allowedMimeTypes.includes(file.mimetype)) {
          cb(new Error('Unsupported file type'));
          return;
        }
      }
      cb(null, true);
    },
  }).single(fieldName);

  return (req, res, next) => {
    uploader(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 400, 'File is too large', error.message);
      }
      return sendError(res, 400, 'File upload failed', error.message);
    });
  };
}

function resolveUploadedFileUrl(req, filePath = '') {
  return buildPublicFileUrl(req, filePath.replace(/^\/+/, ''));
}

function jsonParseSafe(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

module.exports = {
  asyncHandler,
  sendSuccess,
  sendError,
  validateRequest,
  getPageLimit,
  buildPagination,
  createUploadMiddleware,
  resolveUploadedFileUrl,
  jsonParseSafe,
};

