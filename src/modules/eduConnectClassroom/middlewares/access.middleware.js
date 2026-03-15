const eduAuthMiddleware = require('../../../../middleware/eduAuthMiddleware');
const { runQuery } = require('../../../../utils/eduSchema');

function requireAuth(req, res, next) {
  return eduAuthMiddleware(req, res, next);
}

function requireAnyRole(...roles) {
  const normalized = roles.map((role) => String(role || '').trim()).filter(Boolean);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!normalized.includes(req.user.role)) {
      return res.status(403).json({ message: `Forbidden for role ${req.user.role}` });
    }

    return next();
  };
}

async function resolveCourseAccess(req, res, next) {
  const courseId = Number(req.params.courseId);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return res.status(400).json({ message: 'Invalid courseId' });
  }

  try {
    const rows = await runQuery(
      `SELECT
        c.id,
        c.teacher_id,
        c.status,
        cl.id AS classroom_id,
        CASE WHEN c.teacher_id = ? THEN 1 ELSE 0 END AS is_owner,
        CASE WHEN EXISTS(
          SELECT 1 FROM course_staff cs
          WHERE cs.course_id = c.id AND cs.user_id = ?
        ) THEN 1 ELSE 0 END AS is_staff,
        CASE WHEN EXISTS(
          SELECT 1 FROM classroom_members cm
          WHERE cm.classroom_id = cl.id
            AND cm.user_id = ?
            AND cm.is_active = 1
            AND cm.removed_at IS NULL
        ) THEN 1 ELSE 0 END AS is_member
      FROM courses c
      JOIN classrooms cl ON cl.course_id = c.id
      WHERE c.id = ?
      LIMIT 1`,
      [req.user?.id || 0, req.user?.id || 0, req.user?.id || 0, courseId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const row = rows[0];
    req.courseAccess = {
      courseId: Number(row.id),
      classroomId: Number(row.classroom_id),
      teacherId: Number(row.teacher_id),
      status: row.status,
      isOwner: Boolean(row.is_owner),
      isStaff: Boolean(row.is_staff),
      isApprovedMember: Boolean(row.is_member),
    };

    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Failed to resolve course access', error: error.message });
  }
}

function requireCourseManagementRole(req, res, next) {
  if (!req.courseAccess) {
    return res.status(500).json({ message: 'Course access context is missing' });
  }

  if (req.courseAccess.isOwner || req.courseAccess.isStaff) {
    return next();
  }

  return res.status(403).json({ message: 'Only teacher/assistant can manage this course' });
}

function requireApprovedClassroomMember(req, res, next) {
  if (!req.courseAccess) {
    return res.status(500).json({ message: 'Course access context is missing' });
  }

  if (req.courseAccess.isOwner || req.courseAccess.isStaff || req.courseAccess.isApprovedMember) {
    return next();
  }

  return res.status(403).json({ message: 'Classroom access requires approved membership' });
}

function requireCourseActiveForMutation(req, res, next) {
  if (!req.courseAccess) {
    return res.status(500).json({ message: 'Course access context is missing' });
  }

  if (req.courseAccess.status !== 'active') {
    return res.status(409).json({ message: 'Course is archived and currently read-only' });
  }

  return next();
}

module.exports = {
  requireAuth,
  requireAnyRole,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
};

