const express = require('express');
const controller = require('../controllers/classroom.controller');
const {
  requireAuth,
  requireAnyRole,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
} = require('../middlewares/access.middleware');
const {
  validateWith,
  validateCreateCourse,
  validateUpdateCourse,
  validateEnrollmentRequest,
  validateEnrollmentReview,
  validateAddAssistant,
  validateCreateNotice,
  validateUpdateNotice,
} = require('../validations/classroom.validation');

const router = express.Router();

router.get('/courses', controller.listCourses);
router.get('/courses/:courseId', controller.getCourse);

router.post(
  '/courses',
  requireAuth,
  requireAnyRole('teacher'),
  validateWith(validateCreateCourse),
  controller.createCourse
);

router.patch(
  '/courses/:courseId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  validateWith(validateUpdateCourse),
  controller.updateCourse
);

router.patch(
  '/courses/:courseId/archive',
  requireAuth,
  resolveCourseAccess,
  requireAnyRole('teacher'),
  requireCourseManagementRole,
  controller.archiveCourse
);

//here is the new version of activate endpoint without the redundant requireAnyRole('teacher') since requireCourseManagementRole already checks for teacher/assistant role

router.patch(
  '/courses/:courseId/activate',
  requireAuth,
  resolveCourseAccess,
  requireAnyRole('teacher'),
  requireCourseManagementRole,
  controller.activateCourse
);

router.post(
  '/courses/:courseId/enrollment-requests',
  requireAuth,
  requireAnyRole('student'),
  resolveCourseAccess,
  requireCourseActiveForMutation,
  validateWith(validateEnrollmentRequest),
  controller.submitEnrollmentRequest
);

router.get(
  '/courses/:courseId/enrollment-requests',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  controller.listEnrollmentRequests
);

router.patch(
  '/courses/:courseId/enrollment-requests/:requestId/approve',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  validateWith(validateEnrollmentReview),
  controller.approveEnrollmentRequest
);

router.patch(
  '/courses/:courseId/enrollment-requests/:requestId/reject',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  validateWith(validateEnrollmentReview),
  controller.rejectEnrollmentRequest
);

router.get('/me/enrollments', requireAuth, requireAnyRole('student'), controller.myEnrollments);

router.get(
  '/courses/:courseId/classroom',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getClassroom
);

router.get(
  '/courses/:courseId/classroom/members',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listClassroomMembers
);

router.post(
  '/courses/:courseId/classroom/members',
  requireAuth,
  resolveCourseAccess,
  requireAnyRole('teacher'),
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  validateWith(validateAddAssistant),
  controller.addAssistant
);

router.delete(
  '/courses/:courseId/classroom/members/:memberId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.removeClassroomMember
);

router.post(
  '/courses/:courseId/classroom/discussions',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
  controller.createDiscussionThread
);

router.get(
  '/courses/:courseId/classroom/discussions',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listDiscussionThreads
);

router.get(
  '/courses/:courseId/classroom/discussions/:threadId',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getDiscussionThread
);

router.patch(
  '/courses/:courseId/classroom/discussions/:threadId',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
  controller.updateDiscussionThread
);

router.delete(
  '/courses/:courseId/classroom/discussions/:threadId',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
  controller.deleteDiscussionThread
);

router.post(
  '/courses/:courseId/classroom/discussions/:threadId/messages',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
  controller.createDiscussionMessage
);

router.get(
  '/courses/:courseId/classroom/discussions/:threadId/messages',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listDiscussionMessages
);

router.post(
  '/courses/:courseId/classroom/notices',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  validateWith(validateCreateNotice),
  controller.createNotice
);

router.get(
  '/courses/:courseId/classroom/notices',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listNotices
);

router.patch(
  '/courses/:courseId/classroom/notices/:noticeId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  validateWith(validateUpdateNotice),
  controller.updateNotice
);

router.patch(
  '/courses/:courseId/classroom/notices/:noticeId/pin',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.pinNotice
);

router.patch(
  '/courses/:courseId/classroom/notices/:noticeId/unpin',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.unpinNotice
);

router.delete(
  '/courses/:courseId/classroom/notices/:noticeId',
  requireAuth,
  resolveCourseAccess,
  requireAnyRole('teacher'),
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.deleteNotice
);

router.post(
  '/courses/:courseId/classroom/exams',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createExam
);

router.get(
  '/courses/:courseId/classroom/exams',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listExams
);

router.get(
  '/courses/:courseId/classroom/exams/:itemId',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getExam
);

router.patch(
  '/courses/:courseId/classroom/exams/:itemId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.updateExam
);

router.patch(
  '/courses/:courseId/classroom/exams/:itemId/publish',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.publishExam
);

router.patch(
  '/courses/:courseId/classroom/exams/:itemId/close',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.closeExam
);

router.post(
  '/courses/:courseId/classroom/exams/:itemId/submissions',
  requireAuth,
  requireAnyRole('student'),
  resolveCourseAccess,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
  controller.submitExam
);

router.get(
  '/courses/:courseId/classroom/exams/:itemId/submissions',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  controller.listExamSubmissions
);

router.post(
  '/courses/:courseId/classroom/assignments',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createAssignment
);

router.get(
  '/courses/:courseId/classroom/assignments',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listAssignments
);

router.get(
  '/courses/:courseId/classroom/assignments/:itemId',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getAssignment
);

router.patch(
  '/courses/:courseId/classroom/assignments/:itemId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.updateAssignment
);

router.patch(
  '/courses/:courseId/classroom/assignments/:itemId/publish',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.publishAssignment
);

router.patch(
  '/courses/:courseId/classroom/assignments/:itemId/close',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.closeAssignment
);

router.post(
  '/courses/:courseId/classroom/assignments/:itemId/submissions',
  requireAuth,
  requireAnyRole('student'),
  resolveCourseAccess,
  requireApprovedClassroomMember,
  requireCourseActiveForMutation,
  controller.submitAssignment
);

router.get(
  '/courses/:courseId/classroom/assignments/:itemId/submissions',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  controller.listAssignmentSubmissions
);

router.post(
  '/courses/:courseId/classroom/notes',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createNote
);

router.get(
  '/courses/:courseId/classroom/notes',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listNotes
);

router.patch(
  '/courses/:courseId/classroom/notes/:noteId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.updateNote
);

router.delete(
  '/courses/:courseId/classroom/notes/:noteId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.deleteNote
);

router.post(
  '/courses/:courseId/classroom/resources',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createResource
);

router.get(
  '/courses/:courseId/classroom/resources',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listResources
);

router.delete(
  '/courses/:courseId/classroom/resources/:resourceId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.deleteResource
);

router.post(
  '/courses/:courseId/classroom/live-sessions',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createLiveSession
);

router.get(
  '/courses/:courseId/classroom/live-sessions',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listLiveSessions
);

router.get(
  '/courses/:courseId/classroom/live-sessions/:sessionId',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getLiveSession
);

router.post(
  '/courses/:courseId/classroom/live-sessions/:sessionId/join',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.joinLiveSession
);

router.post(
  '/courses/:courseId/classroom/live-sessions/:sessionId/end',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  controller.endLiveSession
);

router.post(
  '/courses/:courseId/classroom/attendance/sessions',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createAttendanceSession
);

router.get(
  '/courses/:courseId/classroom/attendance/sessions',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  controller.listAttendanceSessions
);

router.post(
  '/courses/:courseId/classroom/attendance/sessions/:sessionId/mark',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.markAttendance
);

router.get(
  '/courses/:courseId/classroom/attendance/records',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  controller.listAttendanceRecords
);

router.get(
  '/courses/:courseId/classroom/attendance/me',
  requireAuth,
  requireAnyRole('student'),
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.myAttendance
);

router.post(
  '/courses/:courseId/classroom/grades/items',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createGradeItem
);

router.get(
  '/courses/:courseId/classroom/grades/items',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listGradeItems
);

router.post(
  '/courses/:courseId/classroom/grades/items/:gradeItemId/entries',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.upsertGradeEntries
);

router.patch(
  '/courses/:courseId/classroom/grades/entries/:entryId',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.updateGradeEntry
);

router.get(
  '/courses/:courseId/classroom/grades/me',
  requireAuth,
  requireAnyRole('student'),
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.myGrades
);

router.get('/notifications', requireAuth, controller.listNotifications);
router.get('/notifications/unread-count', requireAuth, controller.unreadNotificationCount);
router.patch('/notifications/:notificationId/read', requireAuth, controller.markNotificationRead);
router.patch('/notifications/read-all', requireAuth, controller.markAllNotificationsRead);

router.get(
  '/courses/:courseId/live-room',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getActiveLiveRoom
);

router.post(
  '/courses/:courseId/live-room',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.activateLiveRoom
);

router.get(
  '/courses/:courseId/materials',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.listMaterials
);

router.post(
  '/courses/:courseId/materials',
  requireAuth,
  resolveCourseAccess,
  requireCourseManagementRole,
  requireCourseActiveForMutation,
  controller.createMaterial
);

router.get(
  '/courses/:courseId/materials/public',
  controller.listPublicMaterials
);

router.get(
  '/courses/:courseId/group-chat',
  requireAuth,
  resolveCourseAccess,
  requireApprovedClassroomMember,
  controller.getGroupChat
);

module.exports = router;

