const eduAuthMiddleware = require('../../../../middleware/eduAuthMiddleware');
const { runQuery } = require('../../../../utils/eduSchema');

function sendError(res, statusCode, message, error = null) {
  return res.status(statusCode).json({
    success: false,
    message,
    error,
  });
}

function requireAuth(req, res, next) {
  return eduAuthMiddleware(req, res, next);
}

async function resolveCourseContext(req, res, next) {
  const courseId = Number(req.params.courseId);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return sendError(res, 400, 'Invalid courseId', 'courseId must be a positive integer');
  }

  try {
    const rows = await runQuery(
      `SELECT
        c.id AS course_id,
        c.teacher_id,
        cl.id AS classroom_id,
        CASE WHEN c.teacher_id = ? THEN 1 ELSE 0 END AS is_teacher,
        CASE WHEN EXISTS (
          SELECT 1
          FROM classroom_members cm
          WHERE cm.classroom_id = cl.id
            AND cm.user_id = ?
            AND cm.membership_role = 'student'
            AND cm.is_active = 1
            AND cm.removed_at IS NULL
        ) THEN 1 ELSE 0 END AS is_student_member,
        CASE WHEN EXISTS (
          SELECT 1
          FROM course_enrollment_requests cer
          WHERE cer.course_id = c.id
            AND cer.student_id = ?
            AND cer.status = 'approved'
        ) THEN 1 ELSE 0 END AS has_approved_enrollment
      FROM courses c
      LEFT JOIN classrooms cl ON cl.course_id = c.id
      WHERE c.id = ?
      LIMIT 1`,
      [req.user?.id || 0, req.user?.id || 0, req.user?.id || 0, courseId]
    );

    if (!rows.length) {
      return sendError(res, 404, 'Course not found', 'No course exists with this courseId');
    }

    const row = rows[0];
    const isTeacher = Boolean(row.is_teacher);
    const isEnrolledStudent = Boolean(row.is_student_member) || Boolean(row.has_approved_enrollment);

    req.courseContext = {
      courseId: Number(row.course_id),
      classroomId: row.classroom_id ? Number(row.classroom_id) : null,
      teacherId: Number(row.teacher_id),
      isTeacher,
      isEnrolledStudent,
      isClassroomMember: isTeacher || isEnrolledStudent,
    };

    return next();
  } catch (error) {
    return sendError(res, 500, 'Failed to resolve course context', error.message);
  }
}

function isEnrolledStudent() {
  return (req, res, next) => {
    if (!req.courseContext) {
      return sendError(res, 500, 'Course context missing', 'resolveCourseContext middleware is required');
    }

    if (!req.courseContext.isEnrolledStudent) {
      return sendError(res, 403, 'Forbidden', 'Only actively enrolled students can access this resource');
    }

    return next();
  };
}

function isCourseTeacher() {
  return (req, res, next) => {
    if (!req.courseContext) {
      return sendError(res, 500, 'Course context missing', 'resolveCourseContext middleware is required');
    }

    if (!req.courseContext.isTeacher) {
      return sendError(res, 403, 'Forbidden', 'Only the course teacher can access this resource');
    }

    return next();
  };
}

function isClassroomMember() {
  return (req, res, next) => {
    if (!req.courseContext) {
      return sendError(res, 500, 'Course context missing', 'resolveCourseContext middleware is required');
    }

    if (!req.courseContext.isClassroomMember) {
      return sendError(res, 403, 'Forbidden', 'Only classroom members can access this resource');
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  resolveCourseContext,
  isEnrolledStudent,
  isCourseTeacher,
  isClassroomMember,
};

