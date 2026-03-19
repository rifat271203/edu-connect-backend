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
  createUploadMiddleware,
  resolveUploadedFileUrl,
} = require('./common');
const {
  requireAuth,
  resolveCourseContext,
  isClassroomMember,
  isCourseTeacher,
  isEnrolledStudent,
} = require('../middlewares/roomAccess.middleware');

const router = express.Router({ mergeParams: true });

const uploadNoticeAttachment = createUploadMiddleware({
  fieldName: 'attachment',
  maxSizeBytes: 25 * 1024 * 1024,
});

router.use(requireAuth, resolveCourseContext, isClassroomMember());

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
        `SELECT
          n.id,
          n.course_id,
          n.author_id,
          n.title,
          n.body,
          n.priority,
          n.pinned,
          n.attachment_url,
          n.created_at,
          n.updated_at,
          u.name AS author_name,
          u.profile_pic_url AS author_profile_pic_url,
          (SELECT COUNT(*) FROM classroom_notice_acknowledgements a WHERE a.notice_id = n.id) AS acknowledgement_count
        FROM classroom_room_notices n
        JOIN edu_users u ON u.id = n.author_id
        WHERE n.course_id = ?
        ORDER BY n.pinned DESC, n.created_at DESC
        LIMIT ? OFFSET ?`,
        [courseId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_room_notices WHERE course_id = ?', [courseId]),
    ]);

    const notices = rows.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      author: {
        id: item.author_id,
        name: item.author_name,
        profilePicUrl: item.author_profile_pic_url,
      },
      title: item.title,
      body: item.body,
      priority: item.priority,
      pinned: Boolean(item.pinned),
      attachmentUrl: item.attachment_url,
      acknowledgements: Number(item.acknowledgement_count || 0),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));

    return sendSuccess(
      res,
      {
        notices,
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Notices fetched'
    );
  })
);

router.post(
  '/',
  isCourseTeacher(),
  uploadNoticeAttachment,
  [
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('body').isString().trim().notEmpty().withMessage('body is required'),
    body('priority')
      .optional()
      .isIn(['low', 'medium', 'high', 'urgent'])
      .withMessage('priority must be low/medium/high/urgent'),
    body('pinned').optional().isBoolean().withMessage('pinned must be boolean'),
    body('attachmentUrl').optional().isString().trim().notEmpty().withMessage('attachmentUrl must be a non-empty string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const attachmentUrl = req.file
      ? resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`)
      : req.body.attachmentUrl || null;

    const insertResult = await runQuery(
      `INSERT INTO classroom_room_notices
        (course_id, author_id, title, body, priority, pinned, attachment_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId,
        req.user.id,
        req.body.title.trim(),
        req.body.body.trim(),
        req.body.priority || 'low',
        req.body.pinned ? 1 : 0,
        attachmentUrl,
      ]
    );

    const rows = await runQuery(
      `SELECT id, course_id, author_id, title, body, priority, pinned, attachment_url, created_at
       FROM classroom_room_notices
       WHERE id = ?
       LIMIT 1`,
      [insertResult.insertId]
    );

    return sendSuccess(
      res,
      {
        notice: {
          id: rows[0].id,
          courseId: rows[0].course_id,
          author: rows[0].author_id,
          title: rows[0].title,
          body: rows[0].body,
          priority: rows[0].priority,
          pinned: Boolean(rows[0].pinned),
          attachmentUrl: rows[0].attachment_url,
          acknowledgements: [],
          createdAt: rows[0].created_at,
        },
      },
      'Notice created',
      201
    );
  })
);

router.put(
  '/:noticeId',
  isCourseTeacher(),
  uploadNoticeAttachment,
  [
    param('noticeId').isInt({ min: 1 }).withMessage('noticeId must be a positive integer'),
    body('title').optional().isString().trim().notEmpty().withMessage('title must be a non-empty string'),
    body('body').optional().isString().trim().notEmpty().withMessage('body must be a non-empty string'),
    body('priority')
      .optional()
      .isIn(['low', 'medium', 'high', 'urgent'])
      .withMessage('priority must be low/medium/high/urgent'),
    body('pinned').optional().isBoolean().withMessage('pinned must be boolean'),
    body('attachmentUrl').optional().isString().trim().notEmpty().withMessage('attachmentUrl must be a non-empty string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noticeId = Number(req.params.noticeId);
    const courseId = Number(req.params.courseId);

    const existingRows = await runQuery(
      'SELECT id, attachment_url FROM classroom_room_notices WHERE id = ? AND course_id = ? LIMIT 1',
      [noticeId, courseId]
    );

    if (!existingRows.length) {
      return sendError(res, 404, 'Notice not found', 'No notice exists with this noticeId for the course');
    }

    const fields = [];
    const values = [];

    if (req.body.title !== undefined) {
      fields.push('title = ?');
      values.push(req.body.title.trim());
    }
    if (req.body.body !== undefined) {
      fields.push('body = ?');
      values.push(req.body.body.trim());
    }
    if (req.body.priority !== undefined) {
      fields.push('priority = ?');
      values.push(req.body.priority);
    }
    if (req.body.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(req.body.pinned ? 1 : 0);
    }

    if (req.file) {
      fields.push('attachment_url = ?');
      values.push(resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`));
    } else if (req.body.attachmentUrl !== undefined) {
      fields.push('attachment_url = ?');
      values.push(req.body.attachmentUrl || null);
    }

    if (!fields.length) {
      return sendError(res, 400, 'Invalid update payload', 'At least one editable field is required');
    }

    values.push(noticeId, courseId);
    await runQuery(`UPDATE classroom_room_notices SET ${fields.join(', ')} WHERE id = ? AND course_id = ?`, values);

    const rows = await runQuery(
      `SELECT id, course_id, author_id, title, body, priority, pinned, attachment_url, created_at, updated_at
       FROM classroom_room_notices
       WHERE id = ?
       LIMIT 1`,
      [noticeId]
    );

    return sendSuccess(
      res,
      {
        notice: {
          id: rows[0].id,
          courseId: rows[0].course_id,
          author: rows[0].author_id,
          title: rows[0].title,
          body: rows[0].body,
          priority: rows[0].priority,
          pinned: Boolean(rows[0].pinned),
          attachmentUrl: rows[0].attachment_url,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at,
        },
      },
      'Notice updated'
    );
  })
);

router.delete(
  '/:noticeId',
  isCourseTeacher(),
  [param('noticeId').isInt({ min: 1 }).withMessage('noticeId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noticeId = Number(req.params.noticeId);
    const courseId = Number(req.params.courseId);

    const result = await runQuery('DELETE FROM classroom_room_notices WHERE id = ? AND course_id = ?', [noticeId, courseId]);
    if (!result.affectedRows) {
      return sendError(res, 404, 'Notice not found', 'No notice exists with this noticeId for the course');
    }

    return sendSuccess(res, { noticeId }, 'Notice deleted');
  })
);

router.post(
  '/:noticeId/acknowledge',
  isEnrolledStudent(),
  [param('noticeId').isInt({ min: 1 }).withMessage('noticeId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noticeId = Number(req.params.noticeId);
    const courseId = Number(req.params.courseId);

    const noticeRows = await runQuery('SELECT id FROM classroom_room_notices WHERE id = ? AND course_id = ? LIMIT 1', [noticeId, courseId]);
    if (!noticeRows.length) {
      return sendError(res, 404, 'Notice not found', 'No notice exists with this noticeId for the course');
    }

    await runQuery(
      `INSERT INTO classroom_notice_acknowledgements (notice_id, user_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE acknowledged_at = CURRENT_TIMESTAMP`,
      [noticeId, req.user.id]
    );

    return sendSuccess(
      res,
      {
        noticeId,
        userId: req.user.id,
      },
      'Notice acknowledged'
    );
  })
);

router.get(
  '/:noticeId/acknowledgements',
  isCourseTeacher(),
  [
    param('noticeId').isInt({ min: 1 }).withMessage('noticeId must be a positive integer'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noticeId = Number(req.params.noticeId);
    const courseId = Number(req.params.courseId);
    const { page, limit } = getPageLimit(req.query, { page: 1, limit: 20, maxLimit: 100 });
    const offset = (page - 1) * limit;

    const noticeRows = await runQuery('SELECT id FROM classroom_room_notices WHERE id = ? AND course_id = ? LIMIT 1', [noticeId, courseId]);
    if (!noticeRows.length) {
      return sendError(res, 404, 'Notice not found', 'No notice exists with this noticeId for the course');
    }

    const [rows, totalRows] = await Promise.all([
      runQuery(
        `SELECT a.notice_id, a.user_id, a.acknowledged_at, u.name, u.email, u.profile_pic_url
         FROM classroom_notice_acknowledgements a
         JOIN edu_users u ON u.id = a.user_id
         WHERE a.notice_id = ?
         ORDER BY a.acknowledged_at DESC
         LIMIT ? OFFSET ?`,
        [noticeId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_notice_acknowledgements WHERE notice_id = ?', [noticeId]),
    ]);

    return sendSuccess(
      res,
      {
        acknowledgements: rows.map((item) => ({
          noticeId: item.notice_id,
          user: {
            id: item.user_id,
            name: item.name,
            email: item.email,
            profilePicUrl: item.profile_pic_url,
          },
          acknowledgedAt: item.acknowledged_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Acknowledgements fetched'
    );
  })
);

module.exports = router;

