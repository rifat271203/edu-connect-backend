const express = require('express');
const { body, param, query } = require('express-validator');
const { runQuery } = require('../../../../utils/eduSchema');
const {
  asyncHandler,
  sendSuccess,
  sendError,
  validateRequest,
  createUploadMiddleware,
  resolveUploadedFileUrl,
} = require('./common');
const {
  requireAuth,
  resolveCourseContext,
  isClassroomMember,
  isCourseTeacher,
} = require('../middlewares/roomAccess.middleware');

const router = express.Router({ mergeParams: true });

const uploadMessageAttachment = createUploadMiddleware({
  fieldName: 'file',
  maxSizeBytes: 50 * 1024 * 1024,
});

router.use(requireAuth, resolveCourseContext, isClassroomMember());

router.get(
  '/',
  [
    query('cursor').optional().isInt({ min: 1 }).withMessage('cursor must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const cursorClause = cursor ? 'AND m.id < ?' : '';
    const params = cursor ? [courseId, cursor, limit] : [courseId, limit];

    const [rows, totalRows] = await Promise.all([
      runQuery(
        `SELECT
          m.id,
          m.course_id,
          m.sender_id,
          m.content,
          m.file_url,
          m.file_type,
          m.created_at,
          m.is_deleted,
          u.name AS sender_name,
          u.profile_pic_url AS sender_profile_pic_url
        FROM classroom_room_messages m
        JOIN edu_users u ON u.id = m.sender_id
        WHERE m.course_id = ?
          ${cursorClause}
        ORDER BY m.id DESC
        LIMIT ?`,
        params
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_room_messages WHERE course_id = ?', [courseId]),
    ]);

    const messages = rows.reverse().map((item) => ({
      id: item.id,
      courseId: item.course_id,
      sender: {
        id: item.sender_id,
        name: item.sender_name,
        profilePicUrl: item.sender_profile_pic_url,
      },
      content: item.content,
      fileUrl: item.file_url,
      fileType: item.file_type,
      createdAt: item.created_at,
      isDeleted: Boolean(item.is_deleted),
    }));

    const nextCursor = rows.length ? rows[rows.length - 1].id : null;

    return sendSuccess(
      res,
      {
        messages,
        cursor: nextCursor,
        pagination: {
          page: 1,
          limit,
          total: Number(totalRows[0]?.total || 0),
          totalPages: 1,
        },
      },
      'Message history fetched'
    );
  })
);

router.post(
  '/',
  uploadMessageAttachment,
  [body('content').optional().isString().withMessage('content must be a string')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!content && !req.file) {
      return sendError(res, 400, 'Invalid message payload', 'Either content or file attachment is required');
    }

    const fileUrl = req.file ? resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`) : null;
    const fileType = req.file ? req.file.mimetype : null;

    const insertResult = await runQuery(
      `INSERT INTO classroom_room_messages (course_id, sender_id, content, file_url, file_type, is_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [courseId, req.user.id, content || null, fileUrl, fileType]
    );

    const rows = await runQuery(
      `SELECT
        m.id,
        m.course_id,
        m.sender_id,
        m.content,
        m.file_url,
        m.file_type,
        m.created_at,
        m.is_deleted,
        u.name AS sender_name,
        u.profile_pic_url AS sender_profile_pic_url
      FROM classroom_room_messages m
      JOIN edu_users u ON u.id = m.sender_id
      WHERE m.id = ?
      LIMIT 1`,
      [insertResult.insertId]
    );

    const created = rows[0];
    const payload = {
      id: created.id,
      courseId: created.course_id,
      sender: {
        id: created.sender_id,
        name: created.sender_name,
        profilePicUrl: created.sender_profile_pic_url,
      },
      content: created.content,
      fileUrl: created.file_url,
      fileType: created.file_type,
      createdAt: created.created_at,
      isDeleted: Boolean(created.is_deleted),
    };

    const io = req.app.get('io');
    if (io) {
      io.to(String(courseId)).emit('send_message', payload);
    }

    return sendSuccess(res, payload, 'Message sent', 201);
  })
);

router.delete(
  '/:messageId',
  [param('messageId').isInt({ min: 1 }).withMessage('messageId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const messageId = Number(req.params.messageId);

    const rows = await runQuery(
      `SELECT id, sender_id, course_id, is_deleted
       FROM classroom_room_messages
       WHERE id = ? AND course_id = ?
       LIMIT 1`,
      [messageId, courseId]
    );

    if (!rows.length) {
      return sendError(res, 404, 'Message not found', 'No message exists with this messageId for the course');
    }

    const message = rows[0];
    const isOwner = Number(message.sender_id) === Number(req.user.id);
    const isTeacher = Boolean(req.courseContext?.isTeacher);

    if (!isOwner && !isTeacher) {
      return sendError(res, 403, 'Forbidden', 'You can only delete your own message');
    }

    if (!message.is_deleted) {
      await runQuery('UPDATE classroom_room_messages SET is_deleted = 1, content = NULL, file_url = NULL, file_type = NULL WHERE id = ?', [
        messageId,
      ]);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(String(courseId)).emit('message_deleted', {
        messageId,
        courseId,
        deletedBy: req.user.id,
      });
    }

    return sendSuccess(res, { messageId, courseId }, 'Message deleted');
  })
);

module.exports = router;

