function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function getPagination(query = {}) {
  const page = Number.parseInt(query.page, 10) || 1;
  const limit = Number.parseInt(query.limit, 10) || 20;

  return {
    page: page > 0 ? page : 1,
    limit: Math.min(Math.max(limit, 1), 100),
  };
}

function validateWith(validator) {
  return (req, res, next) => {
    const errors = validator(req);
    if (errors.length) {
      return res.status(400).json({
        message: 'Validation failed',
        errors,
      });
    }

    return next();
  };
}

function validateCreateCourse(req) {
  const errors = [];
  const { title, code, coursePicUrl } = req.body || {};

  if (!isNonEmptyString(title)) errors.push('title is required');
  if (!isNonEmptyString(code)) errors.push('code is required');
  if (coursePicUrl !== undefined && typeof coursePicUrl !== 'string') {
    errors.push('coursePicUrl must be a string URL');
  }

  return errors;
}

function validateUpdateCourse(req) {
  const errors = [];
  const { title, code, description, status, coursePicUrl } = req.body || {};

  if (title !== undefined && !isNonEmptyString(title)) errors.push('title must be a non-empty string');
  if (code !== undefined && !isNonEmptyString(code)) errors.push('code must be a non-empty string');
  if (description !== undefined && typeof description !== 'string') errors.push('description must be a string');
  if (coursePicUrl !== undefined && typeof coursePicUrl !== 'string') {
    errors.push('coursePicUrl must be a string URL');
  }
  if (status !== undefined && !['active', 'archived'].includes(status)) {
    errors.push('status must be active or archived');
  }

  if (!Object.keys(req.body || {}).length) {
    errors.push('at least one field is required for update');
  }

  return errors;
}

function validateEnrollmentRequest(req) {
  const errors = [];
  const { note } = req.body || {};

  if (note !== undefined && typeof note !== 'string') {
    errors.push('note must be a string');
  }

  return errors;
}

function validateEnrollmentReview(req) {
  const errors = [];
  const { reviewNote } = req.body || {};
  if (reviewNote !== undefined && typeof reviewNote !== 'string') {
    errors.push('reviewNote must be a string');
  }

  return errors;
}

function validateAddAssistant(req) {
  const errors = [];
  const { userId } = req.body || {};
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
    errors.push('userId must be a positive integer');
  }

  return errors;
}

function validateCreateNotice(req) {
  const errors = [];
  const { title, body, isPinned } = req.body || {};

  if (!isNonEmptyString(title)) errors.push('title is required');
  if (!isNonEmptyString(body)) errors.push('body is required');
  if (isPinned !== undefined && !isBoolean(isPinned)) errors.push('isPinned must be boolean');

  return errors;
}

function validateUpdateNotice(req) {
  const errors = [];
  const { title, body, isPinned } = req.body || {};

  if (title !== undefined && !isNonEmptyString(title)) errors.push('title must be a non-empty string');
  if (body !== undefined && !isNonEmptyString(body)) errors.push('body must be a non-empty string');
  if (isPinned !== undefined && !isBoolean(isPinned)) errors.push('isPinned must be boolean');
  if (!Object.keys(req.body || {}).length) errors.push('at least one field is required for update');

  return errors;
}

module.exports = {
  getPagination,
  validateWith,
  validateCreateCourse,
  validateUpdateCourse,
  validateEnrollmentRequest,
  validateEnrollmentReview,
  validateAddAssistant,
  validateCreateNotice,
  validateUpdateNotice,
};

