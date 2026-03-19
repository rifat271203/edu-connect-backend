const express = require('express');
const messagesRouter = require('./messages.router');
const noticesRouter = require('./notices.router');
const notesRouter = require('./notes.router');
const examsRouter = require('./exams.router');
const scheduleRouter = require('./schedule.router');
const progressRouter = require('./progress.router');
const assignmentsRouter = require('./assignments.router');

const router = express.Router();

router.use('/:courseId/messages', messagesRouter);
router.use('/:courseId/notices', noticesRouter);
router.use('/:courseId/notes', notesRouter);
router.use('/:courseId/exams', examsRouter);
router.use('/:courseId/schedule', scheduleRouter);
router.use('/:courseId/progress', progressRouter);
router.use('/:courseId/assignments', assignmentsRouter);

module.exports = router;

