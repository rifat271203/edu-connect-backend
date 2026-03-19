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

const uploadSharedNoteFile = createUploadMiddleware({
  fieldName: 'file',
  maxSizeBytes: 50 * 1024 * 1024,
});

router.use(requireAuth, resolveCourseContext, isClassroomMember());

router.get(
  '/shared',
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
        `SELECT sn.id, sn.course_id, sn.uploaded_by, sn.title, sn.description, sn.file_url, sn.file_type, sn.category, sn.download_count, sn.created_at,
                u.name AS uploaded_by_name, u.profile_pic_url AS uploaded_by_profile_pic_url
         FROM classroom_shared_notes sn
         JOIN edu_users u ON u.id = sn.uploaded_by
         WHERE sn.course_id = ?
         ORDER BY sn.created_at DESC
         LIMIT ? OFFSET ?`,
        [courseId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_shared_notes WHERE course_id = ?', [courseId]),
    ]);

    return sendSuccess(
      res,
      {
        notes: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          uploadedBy: {
            id: item.uploaded_by,
            name: item.uploaded_by_name,
            profilePicUrl: item.uploaded_by_profile_pic_url,
          },
          title: item.title,
          description: item.description,
          fileUrl: item.file_url,
          fileType: item.file_type,
          category: item.category,
          downloadCount: Number(item.download_count || 0),
          createdAt: item.created_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Shared notes fetched'
    );
  })
);

router.post(
  '/shared',
  isCourseTeacher(),
  uploadSharedNoteFile,
  [
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('description').optional().isString().withMessage('description must be a string'),
    body('category').isIn(['pdf', 'video', 'link', 'doc']).withMessage('category must be pdf/video/link/doc'),
    body('fileUrl').optional().isString().trim().notEmpty().withMessage('fileUrl must be a non-empty string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const fileUrl = req.file
      ? resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`)
      : req.body.fileUrl;

    if (!fileUrl) {
      return sendError(res, 400, 'File is required', 'Provide either file upload or fileUrl');
    }

    const fileType = req.file ? req.file.mimetype : null;

    const insertResult = await runQuery(
      `INSERT INTO classroom_shared_notes
        (course_id, uploaded_by, title, description, file_url, file_type, category, download_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [courseId, req.user.id, req.body.title.trim(), req.body.description || null, fileUrl, fileType, req.body.category]
    );

    const rows = await runQuery(
      `SELECT id, course_id, uploaded_by, title, description, file_url, file_type, category, download_count, created_at
       FROM classroom_shared_notes
       WHERE id = ?
       LIMIT 1`,
      [insertResult.insertId]
    );

    return sendSuccess(
      res,
      {
        note: {
          id: rows[0].id,
          courseId: rows[0].course_id,
          uploadedBy: rows[0].uploaded_by,
          title: rows[0].title,
          description: rows[0].description,
          fileUrl: rows[0].file_url,
          fileType: rows[0].file_type,
          category: rows[0].category,
          downloadCount: Number(rows[0].download_count || 0),
          createdAt: rows[0].created_at,
        },
      },
      'Shared note uploaded',
      201
    );
  })
);

router.delete(
  '/shared/:noteId',
  isCourseTeacher(),
  [param('noteId').isInt({ min: 1 }).withMessage('noteId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noteId = Number(req.params.noteId);
    const courseId = Number(req.params.courseId);

    const result = await runQuery('DELETE FROM classroom_shared_notes WHERE id = ? AND course_id = ?', [noteId, courseId]);
    if (!result.affectedRows) {
      return sendError(res, 404, 'Shared note not found', 'No shared note exists with this noteId for the course');
    }

    return sendSuccess(res, { noteId }, 'Shared note deleted');
  })
);

router.get(
  '/personal',
  isEnrolledStudent(),
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
        `SELECT id, course_id, student_id, title, content, created_at, updated_at
         FROM classroom_personal_notes
         WHERE course_id = ? AND student_id = ?
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
        [courseId, req.user.id, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_personal_notes WHERE course_id = ? AND student_id = ?', [courseId, req.user.id]),
    ]);

    return sendSuccess(
      res,
      {
        notes: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          student: item.student_id,
          title: item.title,
          content: item.content,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Personal notes fetched'
    );
  })
);

router.post(
  '/personal',
  isEnrolledStudent(),
  [
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('content').isString().trim().notEmpty().withMessage('content is required'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);

    const insertResult = await runQuery(
      `INSERT INTO classroom_personal_notes (course_id, student_id, title, content)
       VALUES (?, ?, ?, ?)`,
      [courseId, req.user.id, req.body.title.trim(), req.body.content]
    );

    const rows = await runQuery(
      `SELECT id, course_id, student_id, title, content, created_at, updated_at
       FROM classroom_personal_notes
       WHERE id = ?
       LIMIT 1`,
      [insertResult.insertId]
    );

    return sendSuccess(
      res,
      {
        note: {
          id: rows[0].id,
          courseId: rows[0].course_id,
          student: rows[0].student_id,
          title: rows[0].title,
          content: rows[0].content,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at,
        },
      },
      'Personal note created',
      201
    );
  })
);

router.put(
  '/personal/:noteId',
  isEnrolledStudent(),
  [
    param('noteId').isInt({ min: 1 }).withMessage('noteId must be a positive integer'),
    body('title').optional().isString().trim().notEmpty().withMessage('title must be a non-empty string'),
    body('content').optional().isString().trim().notEmpty().withMessage('content must be a non-empty string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noteId = Number(req.params.noteId);
    const courseId = Number(req.params.courseId);

    const existingRows = await runQuery(
      `SELECT id FROM classroom_personal_notes
       WHERE id = ? AND course_id = ? AND student_id = ?
       LIMIT 1`,
      [noteId, courseId, req.user.id]
    );

    if (!existingRows.length) {
      return sendError(res, 404, 'Personal note not found', 'No personal note exists with this noteId for this student');
    }

    const fields = [];
    const values = [];
    if (req.body.title !== undefined) {
      fields.push('title = ?');
      values.push(req.body.title.trim());
    }
    if (req.body.content !== undefined) {
      fields.push('content = ?');
      values.push(req.body.content);
    }

    if (!fields.length) {
      return sendError(res, 400, 'Invalid update payload', 'At least one editable field is required');
    }

    values.push(noteId, courseId, req.user.id);
    await runQuery(
      `UPDATE classroom_personal_notes
       SET ${fields.join(', ')}
       WHERE id = ? AND course_id = ? AND student_id = ?`,
      values
    );

    const rows = await runQuery(
      `SELECT id, course_id, student_id, title, content, created_at, updated_at
       FROM classroom_personal_notes
       WHERE id = ?
       LIMIT 1`,
      [noteId]
    );

    return sendSuccess(
      res,
      {
        note: {
          id: rows[0].id,
          courseId: rows[0].course_id,
          student: rows[0].student_id,
          title: rows[0].title,
          content: rows[0].content,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at,
        },
      },
      'Personal note updated'
    );
  })
);

router.delete(
  '/personal/:noteId',
  isEnrolledStudent(),
  [param('noteId').isInt({ min: 1 }).withMessage('noteId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const noteId = Number(req.params.noteId);
    const courseId = Number(req.params.courseId);

    const result = await runQuery(
      'DELETE FROM classroom_personal_notes WHERE id = ? AND course_id = ? AND student_id = ?',
      [noteId, courseId, req.user.id]
    );
    if (!result.affectedRows) {
      return sendError(res, 404, 'Personal note not found', 'No personal note exists with this noteId for this student');
    }

    return sendSuccess(res, { noteId }, 'Personal note deleted');
  })
);

module.exports = router;

