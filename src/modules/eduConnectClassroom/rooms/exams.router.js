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
  jsonParseSafe,
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

function buildExamStatus(exam) {
  const now = Date.now();
  const start = new Date(exam.start_time).getTime();
  const end = new Date(exam.end_time).getTime();
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'ongoing';
  return 'past';
}

function parseQuestions(questionsInput = []) {
  return (Array.isArray(questionsInput) ? questionsInput : []).map((q, index) => ({
    id: index + 1,
    questionText: q.questionText,
    type: q.type,
    options: Array.isArray(q.options) ? q.options : [],
    correctAnswer: q.correctAnswer,
    marks: Number(q.marks || 0),
  }));
}

function sanitizeQuestionsForStudent(questions = []) {
  return questions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    type: q.type,
    options: q.options || [],
    marks: Number(q.marks || 0),
  }));
}

router.post(
  '/',
  isCourseTeacher(),
  [
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('instructions').optional().isString().withMessage('instructions must be a string'),
    body('duration').isInt({ min: 1 }).withMessage('duration must be a positive integer (minutes)'),
    body('startTime').isISO8601().withMessage('startTime must be a valid ISO datetime'),
    body('endTime').isISO8601().withMessage('endTime must be a valid ISO datetime'),
    body('totalMarks').isFloat({ min: 0 }).withMessage('totalMarks must be a non-negative number'),
    body('questions').isArray({ min: 1 }).withMessage('questions must be a non-empty array'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const questions = parseQuestions(req.body.questions);

    const insertResult = await runQuery(
      `INSERT INTO classroom_exams
        (course_id, title, instructions, duration_minutes, start_time, end_time, total_marks, questions_json, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
      [
        courseId,
        req.body.title.trim(),
        req.body.instructions || null,
        Number(req.body.duration),
        req.body.startTime,
        req.body.endTime,
        Number(req.body.totalMarks),
        JSON.stringify(questions),
        req.user.id,
      ]
    );

    const rows = await runQuery(
      `SELECT id, course_id, title, instructions, duration_minutes, start_time, end_time, total_marks, questions_json, created_by, status, created_at
       FROM classroom_exams
       WHERE id = ?
       LIMIT 1`,
      [insertResult.insertId]
    );

    const exam = rows[0];
    return sendSuccess(
      res,
      {
        exam: {
          id: exam.id,
          courseId: exam.course_id,
          title: exam.title,
          instructions: exam.instructions,
          duration: exam.duration_minutes,
          startTime: exam.start_time,
          endTime: exam.end_time,
          totalMarks: Number(exam.total_marks),
          questions: jsonParseSafe(exam.questions_json, []),
          createdBy: exam.created_by,
          status: exam.status,
          createdAt: exam.created_at,
        },
      },
      'Exam created',
      201
    );
  })
);

router.put(
  '/:examId',
  isCourseTeacher(),
  [
    param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer'),
    body('title').optional().isString().trim().notEmpty().withMessage('title must be a non-empty string'),
    body('instructions').optional().isString().withMessage('instructions must be a string'),
    body('duration').optional().isInt({ min: 1 }).withMessage('duration must be a positive integer'),
    body('startTime').optional().isISO8601().withMessage('startTime must be a valid ISO datetime'),
    body('endTime').optional().isISO8601().withMessage('endTime must be a valid ISO datetime'),
    body('totalMarks').optional().isFloat({ min: 0 }).withMessage('totalMarks must be a non-negative number'),
    body('questions').optional().isArray({ min: 1 }).withMessage('questions must be a non-empty array'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const courseId = Number(req.params.courseId);

    const existingRows = await runQuery(
      `SELECT id, start_time FROM classroom_exams WHERE id = ? AND course_id = ? LIMIT 1`,
      [examId, courseId]
    );
    if (!existingRows.length) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    if (Date.now() >= new Date(existingRows[0].start_time).getTime()) {
      return sendError(res, 409, 'Exam already started', 'Only non-started exams can be edited');
    }

    const fields = [];
    const values = [];
    if (req.body.title !== undefined) {
      fields.push('title = ?');
      values.push(req.body.title.trim());
    }
    if (req.body.instructions !== undefined) {
      fields.push('instructions = ?');
      values.push(req.body.instructions || null);
    }
    if (req.body.duration !== undefined) {
      fields.push('duration_minutes = ?');
      values.push(Number(req.body.duration));
    }
    if (req.body.startTime !== undefined) {
      fields.push('start_time = ?');
      values.push(req.body.startTime);
    }
    if (req.body.endTime !== undefined) {
      fields.push('end_time = ?');
      values.push(req.body.endTime);
    }
    if (req.body.totalMarks !== undefined) {
      fields.push('total_marks = ?');
      values.push(Number(req.body.totalMarks));
    }
    if (req.body.questions !== undefined) {
      fields.push('questions_json = ?');
      values.push(JSON.stringify(parseQuestions(req.body.questions)));
    }

    if (!fields.length) {
      return sendError(res, 400, 'Invalid update payload', 'At least one editable field is required');
    }

    values.push(examId, courseId);
    await runQuery(`UPDATE classroom_exams SET ${fields.join(', ')} WHERE id = ? AND course_id = ?`, values);

    const rows = await runQuery(
      `SELECT id, course_id, title, instructions, duration_minutes, start_time, end_time, total_marks, questions_json, created_by, status, updated_at
       FROM classroom_exams
       WHERE id = ?
       LIMIT 1`,
      [examId]
    );

    return sendSuccess(
      res,
      {
        exam: {
          id: rows[0].id,
          courseId: rows[0].course_id,
          title: rows[0].title,
          instructions: rows[0].instructions,
          duration: rows[0].duration_minutes,
          startTime: rows[0].start_time,
          endTime: rows[0].end_time,
          totalMarks: Number(rows[0].total_marks),
          questions: jsonParseSafe(rows[0].questions_json, []),
          createdBy: rows[0].created_by,
          status: rows[0].status,
          updatedAt: rows[0].updated_at,
        },
      },
      'Exam updated'
    );
  })
);

router.delete(
  '/:examId',
  isCourseTeacher(),
  [param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const courseId = Number(req.params.courseId);

    const result = await runQuery('DELETE FROM classroom_exams WHERE id = ? AND course_id = ?', [examId, courseId]);
    if (!result.affectedRows) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    return sendSuccess(res, { examId }, 'Exam deleted');
  })
);

router.get(
  '/:examId/submissions',
  isCourseTeacher(),
  [
    param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const courseId = Number(req.params.courseId);
    const { page, limit } = getPageLimit(req.query, { page: 1, limit: 20, maxLimit: 100 });
    const offset = (page - 1) * limit;

    const examRows = await runQuery('SELECT id, total_marks FROM classroom_exams WHERE id = ? AND course_id = ? LIMIT 1', [examId, courseId]);
    if (!examRows.length) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    const [rows, totalRows] = await Promise.all([
      runQuery(
        `SELECT s.id, s.exam_id, s.student_id, s.answers_json, s.score, s.total_marks, s.started_at, s.submitted_at, s.is_graded,
                u.name AS student_name, u.email AS student_email
         FROM classroom_exam_submissions s
         JOIN edu_users u ON u.id = s.student_id
         WHERE s.exam_id = ?
         ORDER BY s.submitted_at DESC, s.id DESC
         LIMIT ? OFFSET ?`,
        [examId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_exam_submissions WHERE exam_id = ?', [examId]),
    ]);

    return sendSuccess(
      res,
      {
        submissions: rows.map((item) => ({
          id: item.id,
          examId: item.exam_id,
          student: {
            id: item.student_id,
            name: item.student_name,
            email: item.student_email,
          },
          answers: jsonParseSafe(item.answers_json, []),
          score: item.score !== null ? Number(item.score) : null,
          totalMarks: item.total_marks !== null ? Number(item.total_marks) : Number(examRows[0].total_marks),
          startedAt: item.started_at,
          submittedAt: item.submitted_at,
          isGraded: Boolean(item.is_graded),
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Exam submissions fetched'
    );
  })
);

router.post(
  '/:examId/grade/:submissionId',
  isCourseTeacher(),
  [
    param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer'),
    param('submissionId').isInt({ min: 1 }).withMessage('submissionId must be a positive integer'),
    body('answers').isArray().withMessage('answers must be an array'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const submissionId = Number(req.params.submissionId);
    const courseId = Number(req.params.courseId);

    const examRows = await runQuery('SELECT id, total_marks FROM classroom_exams WHERE id = ? AND course_id = ? LIMIT 1', [examId, courseId]);
    if (!examRows.length) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    const submissionRows = await runQuery(
      `SELECT id, answers_json
       FROM classroom_exam_submissions
       WHERE id = ? AND exam_id = ?
       LIMIT 1`,
      [submissionId, examId]
    );
    if (!submissionRows.length) {
      return sendError(res, 404, 'Submission not found', 'No submission exists with this submissionId for this exam');
    }

    const answers = req.body.answers;
    let score = 0;
    for (const item of answers) {
      score += Number(item.awardedMarks || 0);
    }

    await runQuery(
      `UPDATE classroom_exam_submissions
       SET answers_json = ?, score = ?, total_marks = ?, is_graded = 1
       WHERE id = ?`,
      [JSON.stringify(answers), score, Number(examRows[0].total_marks), submissionId]
    );

    return sendSuccess(
      res,
      {
        submissionId,
        examId,
        score,
        totalMarks: Number(examRows[0].total_marks),
      },
      'Submission graded'
    );
  })
);

router.get(
  '/',
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
        `SELECT id, course_id, title, instructions, duration_minutes, start_time, end_time, total_marks, status, created_at
         FROM classroom_exams
         WHERE course_id = ?
         ORDER BY start_time DESC
         LIMIT ? OFFSET ?`,
        [courseId, limit, offset]
      ),
      runQuery('SELECT COUNT(*) AS total FROM classroom_exams WHERE course_id = ?', [courseId]),
    ]);

    return sendSuccess(
      res,
      {
        exams: rows.map((item) => ({
          id: item.id,
          courseId: item.course_id,
          title: item.title,
          instructions: item.instructions,
          duration: item.duration_minutes,
          startTime: item.start_time,
          endTime: item.end_time,
          totalMarks: Number(item.total_marks),
          status: buildExamStatus(item),
          createdAt: item.created_at,
        })),
        pagination: buildPagination({ page, limit, total: totalRows[0]?.total || 0 }),
      },
      'Exams fetched'
    );
  })
);

router.get(
  '/:examId/start',
  isEnrolledStudent(),
  [param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const courseId = Number(req.params.courseId);

    const rows = await runQuery(
      `SELECT id, course_id, title, instructions, duration_minutes, start_time, end_time, total_marks, questions_json
       FROM classroom_exams
       WHERE id = ? AND course_id = ?
       LIMIT 1`,
      [examId, courseId]
    );
    if (!rows.length) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    const exam = rows[0];
    const now = Date.now();
    const start = new Date(exam.start_time).getTime();
    const end = new Date(exam.end_time).getTime();

    if (now < start || now > end) {
      return sendError(res, 409, 'Exam not available now', 'Exam can only be started during the valid time window');
    }

    await runQuery(
      `INSERT INTO classroom_exam_submissions (exam_id, student_id, started_at, total_marks, is_graded)
       VALUES (?, ?, NOW(), ?, 0)
       ON DUPLICATE KEY UPDATE started_at = COALESCE(started_at, NOW())`,
      [examId, req.user.id, Number(exam.total_marks)]
    );

    const questions = jsonParseSafe(exam.questions_json, []);
    return sendSuccess(
      res,
      {
        exam: {
          id: exam.id,
          courseId: exam.course_id,
          title: exam.title,
          instructions: exam.instructions,
          duration: exam.duration_minutes,
          startTime: exam.start_time,
          endTime: exam.end_time,
          totalMarks: Number(exam.total_marks),
          questions: sanitizeQuestionsForStudent(questions),
        },
      },
      'Exam started'
    );
  })
);

router.post(
  '/:examId/submit',
  isEnrolledStudent(),
  [
    param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer'),
    body('answers').isArray().withMessage('answers must be an array'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const courseId = Number(req.params.courseId);

    const examRows = await runQuery(
      `SELECT id, course_id, end_time, total_marks, questions_json
       FROM classroom_exams
       WHERE id = ? AND course_id = ?
       LIMIT 1`,
      [examId, courseId]
    );
    if (!examRows.length) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    const exam = examRows[0];
    const now = Date.now();
    const end = new Date(exam.end_time).getTime();
    if (now > end) {
      return sendError(res, 409, 'Submission window closed', 'Exam end time has passed');
    }

    const questions = jsonParseSafe(exam.questions_json, []);
    const submittedAnswers = Array.isArray(req.body.answers) ? req.body.answers : [];

    let score = 0;
    const normalizedAnswers = submittedAnswers.map((ans) => {
      const question = questions.find((q) => Number(q.id) === Number(ans.questionId));
      let awardedMarks = 0;
      if (question && question.type === 'MCQ') {
        const isCorrect = String(ans.answer ?? '').trim() === String(question.correctAnswer ?? '').trim();
        awardedMarks = isCorrect ? Number(question.marks || 0) : 0;
      }
      score += awardedMarks;
      return {
        questionId: ans.questionId,
        answer: ans.answer,
        awardedMarks,
      };
    });

    await runQuery(
      `INSERT INTO classroom_exam_submissions
        (exam_id, student_id, answers_json, score, total_marks, started_at, submitted_at, is_graded)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?)
       ON DUPLICATE KEY UPDATE
         answers_json = VALUES(answers_json),
         score = VALUES(score),
         total_marks = VALUES(total_marks),
         submitted_at = NOW(),
         is_graded = VALUES(is_graded)`,
      [
        examId,
        req.user.id,
        JSON.stringify(normalizedAnswers),
        score,
        Number(exam.total_marks),
        normalizedAnswers.some((a) => Number(a.awardedMarks || 0) === 0) ? 0 : 1,
      ]
    );

    return sendSuccess(
      res,
      {
        examId,
        student: req.user.id,
        score,
        totalMarks: Number(exam.total_marks),
        isGraded: normalizedAnswers.every((a) => a.awardedMarks !== undefined),
      },
      'Exam submitted'
    );
  })
);

router.get(
  '/:examId/result',
  isEnrolledStudent(),
  [param('examId').isInt({ min: 1 }).withMessage('examId must be a positive integer')],
  validateRequest,
  asyncHandler(async (req, res) => {
    const examId = Number(req.params.examId);
    const courseId = Number(req.params.courseId);

    const examRows = await runQuery(
      'SELECT id, end_time, total_marks FROM classroom_exams WHERE id = ? AND course_id = ? LIMIT 1',
      [examId, courseId]
    );
    if (!examRows.length) {
      return sendError(res, 404, 'Exam not found', 'No exam exists with this examId for the course');
    }

    if (Date.now() < new Date(examRows[0].end_time).getTime()) {
      return sendError(res, 409, 'Result not available yet', 'Result can be viewed only after exam ends');
    }

    const rows = await runQuery(
      `SELECT id, exam_id, student_id, answers_json, score, total_marks, started_at, submitted_at, is_graded
       FROM classroom_exam_submissions
       WHERE exam_id = ? AND student_id = ?
       LIMIT 1`,
      [examId, req.user.id]
    );
    if (!rows.length) {
      return sendError(res, 404, 'Result not found', 'You have not submitted this exam');
    }

    const submission = rows[0];
    return sendSuccess(
      res,
      {
        result: {
          submissionId: submission.id,
          examId: submission.exam_id,
          student: submission.student_id,
          answers: jsonParseSafe(submission.answers_json, []),
          score: submission.score !== null ? Number(submission.score) : null,
          totalMarks: submission.total_marks !== null ? Number(submission.total_marks) : Number(examRows[0].total_marks),
          startedAt: submission.started_at,
          submittedAt: submission.submitted_at,
          isGraded: Boolean(submission.is_graded),
        },
      },
      'Exam result fetched'
    );
  })
);

module.exports = router;

