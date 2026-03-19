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

const uploadAssignmentAttachment = createUploadMiddleware({
  fieldName: 'attachment',
  maxSizeBytes: 50 * 1024 * 1024,
});

const uploadSubmissionFile = createUploadMiddleware({
  fieldName: 'file',
  maxSizeBytes: 50 * 1024 * 1024,
});

router.use(requireAuth, resolveCourseContext, isClassroomMember());

router.post(
  '/',
  isCourseTeacher(),
  uploadAssignmentAttachment,
  [
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('description').optional().isString().withMessage('description must be a string'),
    body('dueDate').isISO8601().withMessage('dueDate must be a valid ISO datetime'),
    body('totalMarks').isFloat({ min: 0 }).withMessage('totalMarks must be a non-negative number'),
    body('attachmentUrl').optional().isString().trim().notEmpty().withMessage('attachmentUrl must be a non-empty string'),
    body('allowLateSubmission').optional().isBoolean().withMessage('allowLateSubmission must be boolean'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const attachmentUrl = req.file
      ? resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`)
      : req.body.attachmentUrl || null;

    const insertResult = await runQuery(
      `INSERT INTO classroom_assignments
        (course_id, title, description, due_date, total_marks, attachment_url, allow_late_submission, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId,
        req.body.title.trim(),
        req.body.description || null,
        req.body.dueDate,
        Number(req.body.totalMarks),
        attachmentUrl,
        req.body.allowLateSubmission ? 1 : 0,
        req.user.id,
      ]
    );

    const rows = await runQuery('SELECT * FROM classroom_assignments WHERE id = ? LIMIT 1', [insertResult.insertId]);
    const assignment = rows[0];

    return sendSuccess(
      res,
      {
        assignment: {
          id: assignment.id,
          courseId: assignment.course_id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.due_date,
          totalMarks: Number(assignment.total_marks),
          attachmentUrl: assignment.attachment_url,
          allowLateSubmission: Boolean(assignment.allow_late_submission),
          createdBy: assignment.created_by,
          createdAt: assignment.created_at,
        },
      },
      'Assignment created',
      201
    );
  })
);

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
        `SELECT a.*, u.name AS created_by_name,
                (SELECT COUNT(*) FROM classroom_assignment_submissions s WHERE s.assignment_id = a.id) AS submission_count,
                (SELECT COUNT(*) FROM classroom_assignment_submissions s WHERE s.assignment_id = a.id AND s.student_id = ?) AS my_submission_count
         FROM classroom_assignments a
         JOIN edu_users u ON u.id = a.created_by
         WHERE a.course_id = ?
         ORDER BY a.due_date ASC
         LIMIT ? OFFSET ?`,
        [req.user.id, courseId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_assignments WHERE course_id = ?', [courseId]),
    ]);

    return sendSuccess(
      res,
      {
        assignments: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          title: item.title,
          description: item.description,
          dueDate: item.due_date,
          totalMarks: Number(item.total_marks),
          attachmentUrl: item.attachment_url,
          allowLateSubmission: Boolean(item.allow_late_submission),
          createdBy: {
            id: item.created_by,
            name: item.created_by_name,
          },
          submissionStatus: req.courseContext.isTeacher
            ? { totalSubmissions: Number(item.submission_count || 0) }
            : { submitted: Number(item.my_submission_count || 0) > 0 },
          createdAt: item.created_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Assignments fetched'
    );
  })
);

router.get(
  '/:assignmentId',
  [param('assignmentId').isInt({ min: 1 }).withMessage('assignmentId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const assignmentId = Number(req.params.assignmentId);
    const courseId = Number(req.params.courseId);

    const rows = await runQuery(
      `SELECT a.*, u.name AS created_by_name
       FROM classroom_assignments a
       JOIN edu_users u ON u.id = a.created_by
       WHERE a.id = ? AND a.course_id = ?
       LIMIT 1`,
      [assignmentId, courseId]
    );

    if (!rows.length) {
      return sendError(res, 404, 'Assignment not found', 'No assignment exists with this assignmentId for the course');
    }

    let mySubmission = null;
    if (!req.courseContext.isTeacher) {
      const submissionRows = await runQuery(
        `SELECT id, assignment_id, student_id, file_url, comment, submitted_at, is_late, score, feedback, graded_at
         FROM classroom_assignment_submissions
         WHERE assignment_id = ? AND student_id = ?
         LIMIT 1`,
        [assignmentId, req.user.id]
      );
      if (submissionRows.length) {
        mySubmission = submissionRows[0];
      }
    }

    const assignment = rows[0];
    return sendSuccess(
      res,
      {
        assignment: {
          id: assignment.id,
          courseId: assignment.course_id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.due_date,
          totalMarks: Number(assignment.total_marks),
          attachmentUrl: assignment.attachment_url,
          allowLateSubmission: Boolean(assignment.allow_late_submission),
          createdBy: {
            id: assignment.created_by,
            name: assignment.created_by_name,
          },
          createdAt: assignment.created_at,
          updatedAt: assignment.updated_at,
        },
        mySubmission,
      },
      'Assignment details fetched'
    );
  })
);

router.put(
  '/:assignmentId',
  isCourseTeacher(),
  uploadAssignmentAttachment,
  [
    param('assignmentId').isInt({ min: 1 }).withMessage('assignmentId must be a positive integer'),
    body('title').optional().isString().trim().notEmpty().withMessage('title must be a non-empty string'),
    body('description').optional().isString().withMessage('description must be a string'),
    body('dueDate').optional().isISO8601().withMessage('dueDate must be a valid ISO datetime'),
    body('totalMarks').optional().isFloat({ min: 0 }).withMessage('totalMarks must be a non-negative number'),
    body('attachmentUrl').optional().isString().trim().notEmpty().withMessage('attachmentUrl must be a non-empty string'),
    body('allowLateSubmission').optional().isBoolean().withMessage('allowLateSubmission must be boolean'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const assignmentId = Number(req.params.assignmentId);
    const courseId = Number(req.params.courseId);

    const [assignmentRows, submissionCountRows] = await Promise.all([
      runQuery('SELECT id FROM classroom_assignments WHERE id = ? AND course_id = ? LIMIT 1', [assignmentId, courseId]),
      runQuery('SELECT COUNT(*) AS total FROM classroom_assignment_submissions WHERE assignment_id = ?', [assignmentId]),
    ]);

    if (!assignmentRows.length) {
      return sendError(res, 404, 'Assignment not found', 'No assignment exists with this assignmentId for the course');
    }

    if (Number(submissionCountRows[0]?.total || 0) > 0) {
      return sendError(res, 409, 'Assignment not editable', 'Assignment cannot be edited after submissions exist');
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
    if (req.body.dueDate !== undefined) {
      fields.push('due_date = ?');
      values.push(req.body.dueDate);
    }
    if (req.body.totalMarks !== undefined) {
      fields.push('total_marks = ?');
      values.push(Number(req.body.totalMarks));
    }
    if (req.file) {
      fields.push('attachment_url = ?');
      values.push(resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`));
    } else if (req.body.attachmentUrl !== undefined) {
      fields.push('attachment_url = ?');
      values.push(req.body.attachmentUrl || null);
    }
    if (req.body.allowLateSubmission !== undefined) {
      fields.push('allow_late_submission = ?');
      values.push(req.body.allowLateSubmission ? 1 : 0);
    }

    if (!fields.length) {
      return sendError(res, 400, 'Invalid update payload', 'At least one editable field is required');
    }

    values.push(assignmentId, courseId);
    await runQuery(`UPDATE classroom_assignments SET ${fields.join(', ')} WHERE id = ? AND course_id = ?`, values);

    const rows = await runQuery('SELECT * FROM classroom_assignments WHERE id = ? LIMIT 1', [assignmentId]);

    const assignment = rows[0];
    return sendSuccess(
      res,
      {
        assignment: {
          id: assignment.id,
          courseId: assignment.course_id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.due_date,
          totalMarks: Number(assignment.total_marks),
          attachmentUrl: assignment.attachment_url,
          allowLateSubmission: Boolean(assignment.allow_late_submission),
          createdBy: assignment.created_by,
          createdAt: assignment.created_at,
          updatedAt: assignment.updated_at,
        },
      },
      'Assignment updated'
    );
  })
);

router.post(
  '/:assignmentId/submit',
  isEnrolledStudent(),
  uploadSubmissionFile,
  [
    param('assignmentId').isInt({ min: 1 }).withMessage('assignmentId must be a positive integer'),
    body('fileUrl').optional().isString().trim().notEmpty().withMessage('fileUrl must be a non-empty string'),
    body('comment').optional().isString().withMessage('comment must be a string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const assignmentId = Number(req.params.assignmentId);
    const courseId = Number(req.params.courseId);
    const fileUrl = req.file
      ? resolveUploadedFileUrl(req, `uploads/classroom/${req.file.filename}`)
      : req.body.fileUrl;

    if (!fileUrl) {
      return sendError(res, 400, 'File is required', 'Provide either file upload or fileUrl');
    }

    const assignmentRows = await runQuery(
      `SELECT id, due_date, allow_late_submission, total_marks
       FROM classroom_assignments
       WHERE id = ? AND course_id = ?
       LIMIT 1`,
      [assignmentId, courseId]
    );
    if (!assignmentRows.length) {
      return sendError(res, 404, 'Assignment not found', 'No assignment exists with this assignmentId for the course');
    }

    const assignment = assignmentRows[0];
    const now = new Date();
    const dueDate = new Date(assignment.due_date);
    const isLate = now.getTime() > dueDate.getTime();

    if (isLate && !assignment.allow_late_submission) {
      return sendError(res, 409, 'Late submission not allowed', 'Deadline has passed for this assignment');
    }

    await runQuery(
      `INSERT INTO classroom_assignment_submissions
        (assignment_id, student_id, file_url, comment, submitted_at, is_late)
       VALUES (?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         file_url = VALUES(file_url),
         comment = VALUES(comment),
         submitted_at = NOW(),
         is_late = VALUES(is_late)`,
      [assignmentId, req.user.id, fileUrl, req.body.comment || null, isLate ? 1 : 0]
    );

    const rows = await runQuery(
      `SELECT id, assignment_id, student_id, file_url, comment, submitted_at, is_late, score, feedback, graded_at
       FROM classroom_assignment_submissions
       WHERE assignment_id = ? AND student_id = ?
       LIMIT 1`,
      [assignmentId, req.user.id]
    );

    const submission = rows[0];
    return sendSuccess(
      res,
      {
        submission: {
          id: submission.id,
          assignmentId: submission.assignment_id,
          student: submission.student_id,
          fileUrl: submission.file_url,
          comment: submission.comment,
          submittedAt: submission.submitted_at,
          isLate: Boolean(submission.is_late),
          score: submission.score !== null ? Number(submission.score) : null,
          feedback: submission.feedback,
          gradedAt: submission.graded_at,
        },
      },
      'Assignment submitted',
      201
    );
  })
);

router.get(
  '/:assignmentId/submissions',
  isCourseTeacher(),
  [
    param('assignmentId').isInt({ min: 1 }).withMessage('assignmentId must be a positive integer'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const assignmentId = Number(req.params.assignmentId);
    const courseId = Number(req.params.courseId);
    const { page, limit } = getPageLimit(req.query, { page: 1, limit: 20, maxLimit: 100 });
    const offset = (page - 1) * limit;

    const assignmentRows = await runQuery('SELECT id FROM classroom_assignments WHERE id = ? AND course_id = ? LIMIT 1', [assignmentId, courseId]);
    if (!assignmentRows.length) {
      return sendError(res, 404, 'Assignment not found', 'No assignment exists with this assignmentId for the course');
    }

    const [rows, totalRows] = await Promise.all([
      runQuery(
        `SELECT s.id, s.assignment_id, s.student_id, s.file_url, s.comment, s.submitted_at, s.is_late, s.score, s.feedback, s.graded_at,
                u.name AS student_name, u.email AS student_email
         FROM classroom_assignment_submissions s
         JOIN edu_users u ON u.id = s.student_id
         WHERE s.assignment_id = ?
         ORDER BY s.submitted_at DESC
         LIMIT ? OFFSET ?`,
        [assignmentId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_assignment_submissions WHERE assignment_id = ?', [assignmentId]),
    ]);

    return sendSuccess(
      res,
      {
        submissions: rows.map((item) => ({
          id: item.id,
          assignmentId: item.assignment_id,
          student: {
            id: item.student_id,
            name: item.student_name,
            email: item.student_email,
          },
          fileUrl: item.file_url,
          comment: item.comment,
          submittedAt: item.submitted_at,
          isLate: Boolean(item.is_late),
          score: item.score !== null ? Number(item.score) : null,
          feedback: item.feedback,
          gradedAt: item.graded_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Assignment submissions fetched'
    );
  })
);

router.put(
  '/:assignmentId/grade/:submissionId',
  isCourseTeacher(),
  [
    param('assignmentId').isInt({ min: 1 }).withMessage('assignmentId must be a positive integer'),
    param('submissionId').isInt({ min: 1 }).withMessage('submissionId must be a positive integer'),
    body('score').isFloat({ min: 0 }).withMessage('score must be a non-negative number'),
    body('feedback').optional().isString().withMessage('feedback must be a string'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const assignmentId = Number(req.params.assignmentId);
    const submissionId = Number(req.params.submissionId);
    const courseId = Number(req.params.courseId);

    const assignmentRows = await runQuery(
      `SELECT id, total_marks
       FROM classroom_assignments
       WHERE id = ? AND course_id = ?
       LIMIT 1`,
      [assignmentId, courseId]
    );
    if (!assignmentRows.length) {
      return sendError(res, 404, 'Assignment not found', 'No assignment exists with this assignmentId for the course');
    }

    const maxMarks = Number(assignmentRows[0].total_marks);
    const score = Number(req.body.score);
    if (score > maxMarks) {
      return sendError(res, 400, 'Invalid score', `Score cannot exceed total marks (${maxMarks})`);
    }

    const result = await runQuery(
      `UPDATE classroom_assignment_submissions
       SET score = ?, feedback = ?, graded_at = NOW()
       WHERE id = ? AND assignment_id = ?`,
      [score, req.body.feedback || null, submissionId, assignmentId]
    );

    if (!result.affectedRows) {
      return sendError(res, 404, 'Submission not found', 'No submission exists with this submissionId for this assignment');
    }

    const rows = await runQuery(
      `SELECT id, assignment_id, student_id, file_url, comment, submitted_at, is_late, score, feedback, graded_at
       FROM classroom_assignment_submissions
       WHERE id = ?
       LIMIT 1`,
      [submissionId]
    );

    const graded = rows[0];
    return sendSuccess(
      res,
      {
        submission: {
          id: graded.id,
          assignmentId: graded.assignment_id,
          student: graded.student_id,
          fileUrl: graded.file_url,
          comment: graded.comment,
          submittedAt: graded.submitted_at,
          isLate: Boolean(graded.is_late),
          score: graded.score !== null ? Number(graded.score) : null,
          feedback: graded.feedback,
          gradedAt: graded.graded_at,
        },
      },
      'Submission graded'
    );
  })
);

module.exports = router;

