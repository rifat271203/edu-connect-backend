const express = require('express');
const { body, query, param } = require('express-validator');
const { runQuery } = require('../../../../utils/eduSchema');
const {
  asyncHandler,
  sendSuccess,
  sendError,
  validateRequest,
  getPageLimit,
  buildPagination,
} = require('./common');
const {
  requireAuth,
  resolveCourseContext,
  isClassroomMember,
  isCourseTeacher,
  isEnrolledStudent,
} = require('../middlewares/roomAccess.middleware');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, resolveCourseContext, isClassroomMember());

async function buildStudentProgress(courseId, studentId) {
  const [examRows, assignmentRows, attendanceRows] = await Promise.all([
    runQuery(
      `SELECT s.score, s.total_marks
       FROM classroom_exam_submissions s
       JOIN classroom_exams e ON e.id = s.exam_id
       WHERE e.course_id = ? AND s.student_id = ?`,
      [courseId, studentId]
    ),
    runQuery(
      `SELECT s.score, a.total_marks
       FROM classroom_assignment_submissions s
       JOIN classroom_assignments a ON a.id = s.assignment_id
       WHERE a.course_id = ? AND s.student_id = ?`,
      [courseId, studentId]
    ),
    runQuery(
      `SELECT status
       FROM classroom_session_attendance
       WHERE course_id = ? AND student_id = ?`,
      [courseId, studentId]
    ),
  ]);

  const examSummary = examRows.reduce(
    (acc, item) => {
      acc.obtained += Number(item.score || 0);
      acc.total += Number(item.total_marks || 0);
      return acc;
    },
    { obtained: 0, total: 0 }
  );

  const assignmentSummary = assignmentRows.reduce(
    (acc, item) => {
      acc.obtained += Number(item.score || 0);
      acc.total += Number(item.total_marks || 0);
      return acc;
    },
    { obtained: 0, total: 0 }
  );

  const attendanceTotal = attendanceRows.length;
  const attendancePresent = attendanceRows.filter((r) => r.status === 'present' || r.status === 'late').length;
  const attendancePercent = attendanceTotal ? Number(((attendancePresent / attendanceTotal) * 100).toFixed(2)) : 0;

  return {
    examScores: {
      obtained: examSummary.obtained,
      total: examSummary.total,
      percentage: examSummary.total ? Number(((examSummary.obtained / examSummary.total) * 100).toFixed(2)) : 0,
    },
    assignmentGrades: {
      obtained: assignmentSummary.obtained,
      total: assignmentSummary.total,
      percentage: assignmentSummary.total ? Number(((assignmentSummary.obtained / assignmentSummary.total) * 100).toFixed(2)) : 0,
    },
    attendance: {
      presentOrLate: attendancePresent,
      totalSessions: attendanceTotal,
      percentage: attendancePercent,
    },
  };
}

router.get(
  '/me',
  isEnrolledStudent(),
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const studentId = Number(req.user.id);

    const progress = await buildStudentProgress(courseId, studentId);
    return sendSuccess(
      res,
      {
        studentId,
        courseId,
        progress,
      },
      'Progress fetched'
    );
  })
);

router.get(
  '/students',
  isCourseTeacher(),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const { page, limit } = getPageLimit(req.query, { page: 1, limit: 20, maxLimit: 100 });
    const offset = (page - 1) * limit;

    const [students, totalRows] = await Promise.all([
      runQuery(
        `SELECT DISTINCT u.id, u.name, u.email, u.profile_pic_url
         FROM classroom_members cm
         JOIN classrooms cl ON cl.id = cm.classroom_id
         JOIN edu_users u ON u.id = cm.user_id
         WHERE cl.course_id = ?
           AND cm.membership_role = 'student'
           AND cm.is_active = 1
           AND cm.removed_at IS NULL
         ORDER BY u.name ASC
         LIMIT ? OFFSET ?`,
        [courseId, limit, offset]
      ),
      runQuery(
        `SELECT COUNT(*) AS total
         FROM classroom_members cm
         JOIN classrooms cl ON cl.id = cm.classroom_id
         WHERE cl.course_id = ?
           AND cm.membership_role = 'student'
           AND cm.is_active = 1
           AND cm.removed_at IS NULL`,
        [courseId]
      ),
    ]);

    const summaries = [];
    for (const student of students) {
      const progress = await buildStudentProgress(courseId, student.id);
      summaries.push({
        student: {
          id: student.id,
          name: student.name,
          email: student.email,
          profilePicUrl: student.profile_pic_url,
        },
        progress,
      });
    }

    return sendSuccess(
      res,
      {
        students: summaries,
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Students progress summary fetched'
    );
  })
);

router.get(
  '/students/:studentId',
  isCourseTeacher(),
  [param('studentId').isInt({ min: 1 }).withMessage('studentId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const studentId = Number(req.params.studentId);

    const studentRows = await runQuery(
      `SELECT u.id, u.name, u.email, u.profile_pic_url
       FROM classroom_members cm
       JOIN classrooms cl ON cl.id = cm.classroom_id
       JOIN edu_users u ON u.id = cm.user_id
       WHERE cl.course_id = ?
         AND cm.membership_role = 'student'
         AND cm.user_id = ?
         AND cm.is_active = 1
         AND cm.removed_at IS NULL
       LIMIT 1`,
      [courseId, studentId]
    );

    if (!studentRows.length) {
      return sendError(res, 404, 'Student not found', 'No active enrolled student exists with this studentId in the course');
    }

    const progress = await buildStudentProgress(courseId, studentId);
    return sendSuccess(
      res,
      {
        student: studentRows[0],
        progress,
      },
      'Student progress fetched'
    );
  })
);

router.post(
  '/attendance',
  isCourseTeacher(),
  [
    body('sessionId').isInt({ min: 1 }).withMessage('sessionId must be a positive integer'),
    body('attendances').isArray({ min: 1 }).withMessage('attendances must be a non-empty array'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const sessionId = Number(req.body.sessionId);
    const attendances = Array.isArray(req.body.attendances) ? req.body.attendances : [];

    const sessionRows = await runQuery(
      'SELECT id FROM classroom_schedule_sessions WHERE id = ? AND course_id = ? LIMIT 1',
      [sessionId, courseId]
    );
    if (!sessionRows.length) {
      return sendError(res, 404, 'Session not found', 'No schedule session exists with this sessionId for the course');
    }

    for (const item of attendances) {
      const studentId = Number(item.student);
      const status = item.status;
      if (!studentId || !['present', 'absent', 'late'].includes(status)) {
        return sendError(res, 400, 'Invalid attendance item', 'Each attendance item must include student and status: present/absent/late');
      }

      await runQuery(
        `INSERT INTO classroom_session_attendance (course_id, session_id, student_id, status, marked_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           marked_by = VALUES(marked_by),
           marked_at = CURRENT_TIMESTAMP`,
        [courseId, sessionId, studentId, status, req.user.id]
      );
    }

    const rows = await runQuery(
      `SELECT a.id, a.course_id, a.session_id, a.student_id, a.status, a.marked_by, a.marked_at,
              u.name AS student_name, u.email AS student_email
       FROM classroom_session_attendance a
       JOIN edu_users u ON u.id = a.student_id
       WHERE a.course_id = ? AND a.session_id = ?
       ORDER BY a.student_id ASC`,
      [courseId, sessionId]
    );

    return sendSuccess(
      res,
      {
        sessionId,
        attendances: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          sessionId: item.session_id,
          student: {
            id: item.student_id,
            name: item.student_name,
            email: item.student_email,
          },
          status: item.status,
          markedBy: item.marked_by,
          markedAt: item.marked_at,
        })),
      },
      'Attendance marked'
    );
  })
);

router.get(
  '/attendance',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const { page, limit } = getPageLimit(req.query, { page: 1, limit: 20, maxLimit: 100 });
    const offset = (page - 1) * limit;

    const [rows, totalRows] = await Promise.all([
      runQuery(
        `SELECT a.id, a.course_id, a.session_id, a.student_id, a.status, a.marked_by, a.marked_at,
                s.title AS session_title,
                st.name AS student_name, st.email AS student_email,
                m.name AS marked_by_name
         FROM classroom_session_attendance a
         JOIN classroom_schedule_sessions s ON s.id = a.session_id
         JOIN edu_users st ON st.id = a.student_id
         JOIN edu_users m ON m.id = a.marked_by
         WHERE a.course_id = ?
         ORDER BY a.marked_at DESC
         LIMIT ? OFFSET ?`,
        [courseId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_session_attendance WHERE course_id = ?', [courseId]),
    ]);

    return sendSuccess(
      res,
      {
        attendanceRecords: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          session: {
            id: item.session_id,
            title: item.session_title,
          },
          student: {
            id: item.student_id,
            name: item.student_name,
            email: item.student_email,
          },
          status: item.status,
          markedBy: {
            id: item.marked_by,
            name: item.marked_by_name,
          },
          markedAt: item.marked_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Attendance records fetched'
    );
  })
);

module.exports = router;

