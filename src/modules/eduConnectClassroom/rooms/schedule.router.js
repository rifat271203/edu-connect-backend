const express = require('express');
const { body, param, query } = require('express-validator');
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
} = require('../middlewares/roomAccess.middleware');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, resolveCourseContext, isClassroomMember());

function emitScheduleUpdated(req, payload) {
  const io = req.app.get('io');
  if (io) {
    io.to(String(req.params.courseId)).emit('schedule_updated', payload);
  }
}

router.get(
  '/',
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
        `SELECT id, course_id, title, description, type, start_datetime, end_datetime, meeting_link, location, status, is_recurring, recurrence_rule, created_by, created_at
         FROM classroom_schedule_sessions
         WHERE course_id = ?
         ORDER BY start_datetime ASC
         LIMIT ? OFFSET ?`,
        [courseId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_schedule_sessions WHERE course_id = ?', [courseId]),
    ]);

    return sendSuccess(
      res,
      {
        sessions: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          title: item.title,
          description: item.description,
          type: item.type,
          startDateTime: item.start_datetime,
          endDateTime: item.end_datetime,
          meetingLink: item.meeting_link,
          location: item.location,
          status: item.status,
          isRecurring: Boolean(item.is_recurring),
          recurrenceRule: item.recurrence_rule,
          createdBy: item.created_by,
          createdAt: item.created_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Schedule fetched'
    );
  })
);

router.get(
  '/upcoming',
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);

    const rows = await runQuery(
      `SELECT id, course_id, title, description, type, start_datetime, end_datetime, meeting_link, location, status, is_recurring, recurrence_rule, created_by, created_at
       FROM classroom_schedule_sessions
       WHERE course_id = ?
         AND start_datetime BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
         AND status <> 'cancelled'
       ORDER BY start_datetime ASC`,
      [courseId]
    );

    return sendSuccess(
      res,
      {
        sessions: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          title: item.title,
          description: item.description,
          type: item.type,
          startDateTime: item.start_datetime,
          endDateTime: item.end_datetime,
          meetingLink: item.meeting_link,
          location: item.location,
          status: item.status,
          isRecurring: Boolean(item.is_recurring),
          recurrenceRule: item.recurrence_rule,
          createdBy: item.created_by,
          createdAt: item.created_at,
        })),
        pagination: {
          page: 1,
          limit: rows.length,
          total: rows.length,
          totalPages: 1,
        },
      },
      'Upcoming sessions fetched'
    );
  })
);

router.get(
  '/calendar',
  [
    query('month').isInt({ min: 1, max: 12 }).withMessage('month must be between 1 and 12'),
    query('year').isInt({ min: 1970, max: 9999 }).withMessage('year must be a valid year'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const monthValue = String(month).padStart(2, '0');

    const rows = await runQuery(
      `SELECT id, title, description, type, start_datetime, end_datetime, meeting_link, location, status, is_recurring, recurrence_rule, created_by
       FROM classroom_schedule_sessions
       WHERE course_id = ?
         AND YEAR(start_datetime) = ?
         AND MONTH(start_datetime) = ?
       ORDER BY start_datetime ASC`,
      [courseId, year, month]
    );

    const grouped = {};
    rows.forEach((item) => {
      const dateKey = new Date(item.start_datetime).toISOString().slice(0, 10);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        id: item.id,
        title: item.title,
        description: item.description,
        type: item.type,
        startDateTime: item.start_datetime,
        endDateTime: item.end_datetime,
        meetingLink: item.meeting_link,
        location: item.location,
        status: item.status,
        isRecurring: Boolean(item.is_recurring),
        recurrenceRule: item.recurrence_rule,
        createdBy: item.created_by,
      });
    });

    return sendSuccess(
      res,
      {
        month,
        year,
        key: `${year}-${monthValue}`,
        calendar: grouped,
        pagination: {
          page: 1,
          limit: rows.length,
          total: rows.length,
          totalPages: 1,
        },
      },
      'Calendar schedule fetched'
    );
  })
);

router.post(
  '/',
  isCourseTeacher(),
  [
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('description').optional().isString().withMessage('description must be a string'),
    body('type').isIn(['lecture', 'lab', 'tutorial', 'exam', 'holiday']).withMessage('type must be lecture/lab/tutorial/exam/holiday'),
    body('startDateTime').isISO8601().withMessage('startDateTime must be a valid ISO datetime'),
    body('endDateTime').isISO8601().withMessage('endDateTime must be a valid ISO datetime'),
    body('meetingLink').optional().isString().trim().withMessage('meetingLink must be a string'),
    body('location').optional().isString().trim().withMessage('location must be a string'),
    body('isRecurring').optional().isBoolean().withMessage('isRecurring must be boolean'),
    body('recurrenceRule').optional().isString().withMessage('recurrenceRule must be a string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);

    const insertResult = await runQuery(
      `INSERT INTO classroom_schedule_sessions
        (course_id, title, description, type, start_datetime, end_datetime, meeting_link, location, status, is_recurring, recurrence_rule, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
      [
        courseId,
        req.body.title.trim(),
        req.body.description || null,
        req.body.type,
        req.body.startDateTime,
        req.body.endDateTime,
        req.body.meetingLink || null,
        req.body.location || null,
        req.body.isRecurring ? 1 : 0,
        req.body.recurrenceRule || null,
        req.user.id,
      ]
    );

    const rows = await runQuery('SELECT * FROM classroom_schedule_sessions WHERE id = ? LIMIT 1', [insertResult.insertId]);

    const session = rows[0];
    const payload = {
      id: session.id,
      courseId: session.course_id,
      title: session.title,
      description: session.description,
      type: session.type,
      startDateTime: session.start_datetime,
      endDateTime: session.end_datetime,
      meetingLink: session.meeting_link,
      location: session.location,
      status: session.status,
      isRecurring: Boolean(session.is_recurring),
      recurrenceRule: session.recurrence_rule,
      createdBy: session.created_by,
    };

    emitScheduleUpdated(req, { action: 'created', session: payload });

    return sendSuccess(res, { session: payload }, 'Session created', 201);
  })
);

router.put(
  '/:sessionId',
  isCourseTeacher(),
  [
    param('sessionId').isInt({ min: 1 }).withMessage('sessionId must be a positive integer'),
    body('title').optional().isString().trim().notEmpty().withMessage('title must be a non-empty string'),
    body('description').optional().isString().withMessage('description must be a string'),
    body('type').optional().isIn(['lecture', 'lab', 'tutorial', 'exam', 'holiday']).withMessage('type must be lecture/lab/tutorial/exam/holiday'),
    body('startDateTime').optional().isISO8601().withMessage('startDateTime must be a valid ISO datetime'),
    body('endDateTime').optional().isISO8601().withMessage('endDateTime must be a valid ISO datetime'),
    body('meetingLink').optional().isString().trim().withMessage('meetingLink must be a string'),
    body('location').optional().isString().trim().withMessage('location must be a string'),
    body('status').optional().isIn(['scheduled', 'ongoing', 'completed', 'cancelled']).withMessage('status must be scheduled/ongoing/completed/cancelled'),
    body('isRecurring').optional().isBoolean().withMessage('isRecurring must be boolean'),
    body('recurrenceRule').optional().isString().withMessage('recurrenceRule must be a string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const courseId = Number(req.params.courseId);

    const existingRows = await runQuery('SELECT id FROM classroom_schedule_sessions WHERE id = ? AND course_id = ? LIMIT 1', [sessionId, courseId]);
    if (!existingRows.length) {
      return sendError(res, 404, 'Session not found', 'No schedule session exists with this sessionId for the course');
    }

    const fields = [];
    const values = [];
    if (req.body.title !== undefined) {
      fields.push('title = ?');
      values.push(req.body.title.trim());
    }
    if (req.body.description !== undefined) {
      fields.push('description = ?');
      values.push(req.body.description || null);
    }
    if (req.body.type !== undefined) {
      fields.push('type = ?');
      values.push(req.body.type);
    }
    if (req.body.startDateTime !== undefined) {
      fields.push('start_datetime = ?');
      values.push(req.body.startDateTime);
    }
    if (req.body.endDateTime !== undefined) {
      fields.push('end_datetime = ?');
      values.push(req.body.endDateTime);
    }
    if (req.body.meetingLink !== undefined) {
      fields.push('meeting_link = ?');
      values.push(req.body.meetingLink || null);
    }
    if (req.body.location !== undefined) {
      fields.push('location = ?');
      values.push(req.body.location || null);
    }
    if (req.body.status !== undefined) {
      fields.push('status = ?');
      values.push(req.body.status);
    }
    if (req.body.isRecurring !== undefined) {
      fields.push('is_recurring = ?');
      values.push(req.body.isRecurring ? 1 : 0);
    }
    if (req.body.recurrenceRule !== undefined) {
      fields.push('recurrence_rule = ?');
      values.push(req.body.recurrenceRule || null);
    }

    if (!fields.length) {
      return sendError(res, 400, 'Invalid update payload', 'At least one editable field is required');
    }

    values.push(sessionId, courseId);
    await runQuery(`UPDATE classroom_schedule_sessions SET ${fields.join(', ')} WHERE id = ? AND course_id = ?`, values);

    const rows = await runQuery('SELECT * FROM classroom_schedule_sessions WHERE id = ? LIMIT 1', [sessionId]);

    const session = rows[0];
    const payload = {
      id: session.id,
      courseId: session.course_id,
      title: session.title,
      description: session.description,
      type: session.type,
      startDateTime: session.start_datetime,
      endDateTime: session.end_datetime,
      meetingLink: session.meeting_link,
      location: session.location,
      status: session.status,
      isRecurring: Boolean(session.is_recurring),
      recurrenceRule: session.recurrence_rule,
      createdBy: session.created_by,
    };

    emitScheduleUpdated(req, { action: 'updated', session: payload });

    return sendSuccess(res, { session: payload }, 'Session updated');
  })
);

router.delete(
  '/:sessionId',
  isCourseTeacher(),
  [param('sessionId').isInt({ min: 1 }).withMessage('sessionId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const courseId = Number(req.params.courseId);

    const result = await runQuery(
      `UPDATE classroom_schedule_sessions
       SET status = 'cancelled'
       WHERE id = ? AND course_id = ?`,
      [sessionId, courseId]
    );

    if (!result.affectedRows) {
      return sendError(res, 404, 'Session not found', 'No schedule session exists with this sessionId for the course');
    }

    emitScheduleUpdated(req, {
      action: 'cancelled',
      sessionId,
      courseId,
      status: 'cancelled',
    });

    return sendSuccess(res, { sessionId, status: 'cancelled' }, 'Session cancelled');
  })
);

module.exports = router;

