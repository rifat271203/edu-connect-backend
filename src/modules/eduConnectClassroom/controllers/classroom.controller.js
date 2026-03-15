const crypto = require('crypto');
const { runQuery } = require('../../../../utils/eduSchema');
const service = require('../services/classroom.service');
const { getPagination } = require('../validations/classroom.validation');

function pickSort(req, defaultSortBy = 'created_at') {
  return {
    sortBy: req.query.sortBy || defaultSortBy,
    sortOrder: req.query.sortOrder || 'desc',
  };
}

function sendError(res, error, fallback = 'Request failed') {
  return res.status(error.status || 500).json({
    message: error.message || fallback,
  });
}

function toBool(input) {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') return input.toLowerCase() === 'true';
  return undefined;
}

function mapExamOrAssignmentPayload(body = {}) {
  return {
    title: body.title,
    instructions: body.instructions,
    total_marks: body.totalMarks,
    publish_at: body.publishAt,
    due_at: body.dueAt,
  };
}

async function createCourse(req, res) {
  try {
    const course = await service.createCourse({
      teacherId: req.user.id,
      title: req.body.title,
      code: req.body.code,
      description: req.body.description,
      coursePicUrl: req.body.coursePicUrl,
      department: req.body.department,
    });

    return res.status(201).json({
      message: 'Course created',
      course: {
        id: course.id,
        teacherId: course.teacher_id,
        title: course.title,
        code: course.code,
        description: course.description,
        coursePicUrl: course.course_pic_url,
        department: course.department,
        status: course.status,
        createdAt: course.created_at,
      },
      classroom: {
        id: course.classroom_id,
        courseId: course.id,
        visibility: course.visibility,
      },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create course');
  }
}

async function listCourses(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const { sortBy, sortOrder } = pickSort(req, 'created_at');

    const result = await service.listCourses({
      page,
      limit,
      q: req.query.q,
      status: req.query.status,
      sortBy,
      sortOrder,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list courses');
  }
}

async function getCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const course = await service.getCourseById(courseId);

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    return res.json({ course });
  } catch (error) {
    return sendError(res, error, 'Failed to load course');
  }
}

async function updateCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const payload = { ...(req.body || {}) };
    if (payload.coursePicUrl !== undefined) {
      payload.course_pic_url = payload.coursePicUrl;
      delete payload.coursePicUrl;
    }

    const course = await service.updateCourse(courseId, payload);

    return res.json({
      message: 'Course updated',
      course,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update course');
  }
}

async function archiveCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const course = await service.updateCourseStatus(courseId, 'archived');

    return res.json({
      message: 'Course archived',
      course,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to archive course');
  }
}

async function activateCourse(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const course = await service.updateCourseStatus(courseId, 'active');

    return res.json({
      message: 'Course activated',
      course,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to activate course');
  }
}

async function submitEnrollmentRequest(req, res) {
  try {
    const courseId = Number(req.params.courseId);

    const request = await service.submitEnrollmentRequest({
      courseId,
      studentId: req.user.id,
      note: req.body.note,
    });

    await service.createSingleNotification({
      recipientId: req.courseAccess.teacherId,
      actorId: req.user.id,
      courseId,
      type: 'enrollment_request_submitted',
      entityType: 'enrollment_request',
      entityId: request.id,
      message: `${req.user.name} submitted an enrollment request`,
    });

    return res.status(201).json({
      message: 'Enrollment request submitted',
      request,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to submit enrollment request');
  }
}

async function listEnrollmentRequests(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const { page, limit } = getPagination(req.query);

    const result = await service.listEnrollmentRequests({
      courseId,
      status: req.query.status,
      page,
      limit,
      q: req.query.q,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list enrollment requests');
  }
}

async function approveEnrollmentRequest(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const requestId = Number(req.params.requestId);

    const result = await service.reviewEnrollmentRequest({
      courseId,
      requestId,
      reviewerId: req.user.id,
      action: 'approve',
      reviewNote: req.body.reviewNote,
    });

    await service.createSingleNotification({
      recipientId: result.enrollment.student_id,
      actorId: req.user.id,
      courseId,
      type: 'enrollment_approved',
      entityType: 'enrollment_request',
      entityId: requestId,
      message: 'Your enrollment request has been approved',
    });

    return res.json({
      message: 'Enrollment approved',
      ...result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to approve enrollment request');
  }
}

async function rejectEnrollmentRequest(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const requestId = Number(req.params.requestId);

    const result = await service.reviewEnrollmentRequest({
      courseId,
      requestId,
      reviewerId: req.user.id,
      action: 'reject',
      reviewNote: req.body.reviewNote,
    });

    await service.createSingleNotification({
      recipientId: result.enrollment.student_id,
      actorId: req.user.id,
      courseId,
      type: 'enrollment_rejected',
      entityType: 'enrollment_request',
      entityId: requestId,
      message: 'Your enrollment request has been rejected',
    });

    return res.json({
      message: 'Enrollment rejected',
      ...result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to reject enrollment request');
  }
}

async function myEnrollments(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listMyEnrollmentRequests({
      studentId: req.user.id,
      page,
      limit,
      status: req.query.status,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to fetch your enrollments');
  }
}

async function getClassroom(req, res) {
  try {
    const overview = await service.getClassroomOverview(Number(req.params.courseId));
    return res.json({ classroom: overview });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch classroom overview');
  }
}

async function listClassroomMembers(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listClassroomMembers({
      courseId: Number(req.params.courseId),
      page,
      limit,
      q: req.query.q,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list classroom members');
  }
}

async function addAssistant(req, res) {
  try {
    const result = await service.addAssistant({
      courseId: Number(req.params.courseId),
      userId: Number(req.body.userId),
      addedBy: req.user.id,
    });

    return res.status(201).json({
      message: 'Assistant added',
      assistant: result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to add assistant');
  }
}

async function removeClassroomMember(req, res) {
  try {
    const result = await service.removeMember({
      courseId: Number(req.params.courseId),
      memberId: Number(req.params.memberId),
      removedBy: req.user.id,
    });

    return res.json({
      message: 'Classroom member removed',
      ...result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to remove classroom member');
  }
}

async function createDiscussionThread(req, res) {
  try {
    const thread = await service.createDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title: req.body.title,
      body: req.body.body,
    });

    return res.status(201).json({
      message: 'Discussion thread created',
      thread,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create discussion thread');
  }
}

async function listDiscussionThreads(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const { sortBy, sortOrder } = pickSort(req, 'updated_at');

    const result = await service.listDiscussionThreads({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
      q: req.query.q,
      sortBy,
      sortOrder,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list discussion threads');
  }
}

async function getDiscussionThread(req, res) {
  try {
    const thread = await service.getDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId: Number(req.params.threadId),
    });

    if (!thread) {
      return res.status(404).json({ message: 'Discussion thread not found' });
    }

    return res.json({ thread });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch discussion thread');
  }
}

async function updateDiscussionThread(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const existing = await service.getDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId,
    });

    if (!existing) {
      return res.status(404).json({ message: 'Discussion thread not found' });
    }

    const isPrivileged = req.courseAccess.isOwner || req.courseAccess.isStaff;
    if (!isPrivileged && Number(existing.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Only author or teacher/assistant can update this thread' });
    }

    const thread = await service.updateDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId,
      payload: {
        title: req.body.title,
        body: req.body.body,
        is_locked: req.body.isLocked,
      },
    });

    return res.json({
      message: 'Discussion thread updated',
      thread,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update discussion thread');
  }
}

async function deleteDiscussionThread(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const existing = await service.getDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId,
    });

    if (!existing) {
      return res.status(404).json({ message: 'Discussion thread not found' });
    }

    const isPrivileged = req.courseAccess.isOwner || req.courseAccess.isStaff;
    if (!isPrivileged && Number(existing.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Only author or teacher/assistant can delete this thread' });
    }

    await service.deleteDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId,
    });

    return res.json({ message: 'Discussion thread deleted' });
  } catch (error) {
    return sendError(res, error, 'Failed to delete discussion thread');
  }
}

async function createDiscussionMessage(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const thread = await service.getDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId,
    });

    if (!thread) {
      return res.status(404).json({ message: 'Discussion thread not found' });
    }

    if (thread.is_locked) {
      return res.status(409).json({ message: 'This discussion thread is locked' });
    }

    const message = await service.createDiscussionMessage({
      threadId,
      senderId: req.user.id,
      message: req.body.message,
      parentMessageId: req.body.parentMessageId,
    });

    return res.status(201).json({
      message: 'Message added',
      messageItem: message,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to add discussion message');
  }
}

async function listDiscussionMessages(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const { page, limit } = getPagination(req.query);

    const thread = await service.getDiscussionThread({
      classroomId: req.courseAccess.classroomId,
      threadId,
    });

    if (!thread) {
      return res.status(404).json({ message: 'Discussion thread not found' });
    }

    const result = await service.listDiscussionMessages({
      threadId,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list discussion messages');
  }
}

async function createNotice(req, res) {
  try {
    const notice = await service.createNotice({
      courseId: Number(req.params.courseId),
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title: req.body.title,
      body: req.body.body,
      isPinned: Boolean(req.body.isPinned),
    });

    return res.status(201).json({
      message: 'Notice created',
      notice,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create notice');
  }
}

async function listNotices(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const { sortBy, sortOrder } = pickSort(req, 'created_at');
    const parsedPinned = req.query.isPinned === undefined ? undefined : toBool(req.query.isPinned);

    const result = await service.listNotices({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
      q: req.query.q,
      isPinned: parsedPinned,
      sortBy,
      sortOrder,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list notices');
  }
}

async function updateNotice(req, res) {
  try {
    const notice = await service.updateNotice({
      classroomId: req.courseAccess.classroomId,
      noticeId: Number(req.params.noticeId),
      payload: {
        title: req.body.title,
        body: req.body.body,
        is_pinned: req.body.isPinned,
      },
    });

    return res.json({
      message: 'Notice updated',
      notice,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update notice');
  }
}

async function pinNotice(req, res) {
  try {
    const notice = await service.updateNotice({
      classroomId: req.courseAccess.classroomId,
      noticeId: Number(req.params.noticeId),
      payload: { is_pinned: true },
    });

    return res.json({
      message: 'Notice pinned',
      notice,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to pin notice');
  }
}

async function unpinNotice(req, res) {
  try {
    const notice = await service.updateNotice({
      classroomId: req.courseAccess.classroomId,
      noticeId: Number(req.params.noticeId),
      payload: { is_pinned: false },
    });

    return res.json({
      message: 'Notice unpinned',
      notice,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to unpin notice');
  }
}

async function deleteNotice(req, res) {
  try {
    await service.deleteNotice({
      classroomId: req.courseAccess.classroomId,
      noticeId: Number(req.params.noticeId),
    });

    return res.json({ message: 'Notice deleted' });
  } catch (error) {
    return sendError(res, error, 'Failed to delete notice');
  }
}

function createModuleHandlers(tableName, readableName) {
  return {
    async create(req, res) {
      try {
        const item = await service.createModuleItem({
          tableName,
          classroomId: req.courseAccess.classroomId,
          userId: req.user.id,
          title: req.body.title,
          instructions: req.body.instructions,
          totalMarks: req.body.totalMarks,
        });

        return res.status(201).json({
          message: `${readableName} created`,
          [readableName]: item,
        });
      } catch (error) {
        return sendError(res, error, `Failed to create ${readableName}`);
      }
    },

    async list(req, res) {
      try {
        const { page, limit } = getPagination(req.query);
        const { sortBy, sortOrder } = pickSort(req, 'created_at');

        const result = await service.listModuleItems({
          tableName,
          classroomId: req.courseAccess.classroomId,
          page,
          limit,
          status: req.query.status,
          sortBy,
          sortOrder,
        });

        return res.json(result);
      } catch (error) {
        return sendError(res, error, `Failed to list ${readableName}s`);
      }
    },

    async get(req, res) {
      try {
        const item = await service.getModuleItemById({
          tableName,
          itemId: Number(req.params.itemId),
          classroomId: req.courseAccess.classroomId,
        });

        if (!item) {
          return res.status(404).json({ message: `${readableName} not found` });
        }

        return res.json({ [readableName]: item });
      } catch (error) {
        return sendError(res, error, `Failed to fetch ${readableName}`);
      }
    },

    async update(req, res) {
      try {
        const payload = mapExamOrAssignmentPayload(req.body || {});
        const item = await service.updateModuleItem({
          tableName,
          itemId: Number(req.params.itemId),
          classroomId: req.courseAccess.classroomId,
          payload,
        });

        return res.json({
          message: `${readableName} updated`,
          [readableName]: item,
        });
      } catch (error) {
        return sendError(res, error, `Failed to update ${readableName}`);
      }
    },

    async publish(req, res) {
      try {
        const itemId = Number(req.params.itemId);
        if (req.body.publishAt || req.body.dueAt) {
          await service.updateModuleItem({
            tableName,
            itemId,
            classroomId: req.courseAccess.classroomId,
            payload: {
              publish_at: req.body.publishAt,
              due_at: req.body.dueAt,
            },
          });
        }

        const item = await service.updateModuleItemStatus({
          tableName,
          itemId,
          classroomId: req.courseAccess.classroomId,
          status: 'published',
        });

        await service.createCourseNotificationFanout({
          courseId: Number(req.params.courseId),
          actorId: req.user.id,
          type: tableName === 'exams' ? 'exam_published' : 'assignment_published',
          entityType: tableName === 'exams' ? 'exam' : 'assignment',
          entityId: item.id,
          message: `New ${readableName} published: ${item.title}`,
        });

        return res.json({
          message: `${readableName} published`,
          [readableName]: item,
        });
      } catch (error) {
        return sendError(res, error, `Failed to publish ${readableName}`);
      }
    },

    async close(req, res) {
      try {
        const item = await service.updateModuleItemStatus({
          tableName,
          itemId: Number(req.params.itemId),
          classroomId: req.courseAccess.classroomId,
          status: 'closed',
        });

        return res.json({
          message: `${readableName} closed`,
          [readableName]: item,
        });
      } catch (error) {
        return sendError(res, error, `Failed to close ${readableName}`);
      }
    },

    async submit(req, res) {
      try {
        const itemId = Number(req.params.itemId);
        const item = await service.getModuleItemById({
          tableName,
          itemId,
          classroomId: req.courseAccess.classroomId,
        });

        if (!item) {
          return res.status(404).json({ message: `${readableName} not found` });
        }

        if (item.status !== 'published') {
          return res.status(409).json({ message: `${readableName} is not published` });
        }

        const submission = await service.createModuleSubmission({
          tableName,
          itemId,
          studentId: req.user.id,
          content: req.body.content,
        });

        return res.status(201).json({
          message: 'Submission created',
          submission,
        });
      } catch (error) {
        return sendError(res, error, `Failed to submit ${readableName}`);
      }
    },

    async submissions(req, res) {
      try {
        const { page, limit } = getPagination(req.query);
        const result = await service.listModuleSubmissions({
          tableName,
          itemId: Number(req.params.itemId),
          page,
          limit,
        });

        return res.json(result);
      } catch (error) {
        return sendError(res, error, `Failed to list ${readableName} submissions`);
      }
    },
  };
}

const examHandlers = createModuleHandlers('exams', 'exam');
const assignmentHandlers = createModuleHandlers('assignments', 'assignment');

async function createResource(req, res) {
  try {
    const resource = await service.createResource({
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title: req.body.title,
      description: req.body.description,
      fileUrl: req.body.fileUrl,
      fileType: req.body.fileType,
      fileSize: req.body.fileSize,
    });

    return res.status(201).json({
      message: 'Resource uploaded',
      resource,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to upload resource');
  }
}

async function listResources(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const { sortBy, sortOrder } = pickSort(req, 'created_at');

    const result = await service.listResources({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
      q: req.query.q,
      sortBy,
      sortOrder,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list resources');
  }
}

async function deleteResource(req, res) {
  try {
    await service.deleteResource({
      classroomId: req.courseAccess.classroomId,
      resourceId: Number(req.params.resourceId),
    });

    return res.json({ message: 'Resource deleted' });
  } catch (error) {
    return sendError(res, error, 'Failed to delete resource');
  }
}

async function createNote(req, res) {
  try {
    const note = await service.createNote({
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title: req.body.title,
      body: req.body.body,
    });

    return res.status(201).json({
      message: 'Note created',
      note,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create note');
  }
}

async function listNotes(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const { sortBy, sortOrder } = pickSort(req, 'updated_at');

    const result = await service.listNotes({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
      q: req.query.q,
      sortBy,
      sortOrder,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list notes');
  }
}

async function updateNote(req, res) {
  try {
    const note = await service.updateNote({
      classroomId: req.courseAccess.classroomId,
      noteId: Number(req.params.noteId),
      payload: {
        title: req.body.title,
        body: req.body.body,
      },
    });

    return res.json({
      message: 'Note updated',
      note,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update note');
  }
}

async function deleteNote(req, res) {
  try {
    await service.deleteNote({
      classroomId: req.courseAccess.classroomId,
      noteId: Number(req.params.noteId),
    });

    return res.json({ message: 'Note deleted' });
  } catch (error) {
    return sendError(res, error, 'Failed to delete note');
  }
}

async function createLiveSession(req, res) {
  try {
    const courseId = Number(req.params.courseId);
    const title = req.body.title;

    let meetingId = req.body.meetingId || null;
    let providerRoomId = req.body.providerRoomId || null;

    if (!providerRoomId) {
      providerRoomId = `room_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    }

    if (!meetingId) {
      const insertMeeting = await runQuery(
        `INSERT INTO meetings (room_id, title, host_user_id, is_active)
         VALUES (?, ?, ?, 1)`,
        [providerRoomId, title || null, req.user.id]
      );
      meetingId = insertMeeting.insertId;
    }

    const liveSession = await service.createLiveSession({
      courseId,
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title,
      scheduledAt: req.body.scheduledAt,
      providerRoomId,
      meetingId,
    });

    return res.status(201).json({
      message: 'Live session created',
      liveSession,
      meetingIntegration: {
        roomId: providerRoomId,
        meetingId,
      },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create live session');
  }
}

async function listLiveSessions(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listLiveSessions({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
      status: req.query.status,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list live sessions');
  }
}

async function getLiveSession(req, res) {
  try {
    const session = await service.getLiveSession({
      classroomId: req.courseAccess.classroomId,
      sessionId: Number(req.params.sessionId),
    });

    if (!session) {
      return res.status(404).json({ message: 'Live session not found' });
    }

    return res.json({ liveSession: session });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch live session');
  }
}

async function joinLiveSession(req, res) {
  try {
    const session = await service.markLiveSessionLive({
      classroomId: req.courseAccess.classroomId,
      sessionId: Number(req.params.sessionId),
    });

    await runQuery(
      `INSERT INTO meeting_participants (room_id, user_id, joined_at, left_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, NULL)`,
      [session.provider_room_id, req.user.id]
    );

    return res.json({
      message: 'Joined live session',
      join: {
        roomId: session.provider_room_id,
        meetingId: session.meeting_id,
        provider: session.provider,
      },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to join live session');
  }
}

async function endLiveSession(req, res) {
  try {
    const session = await service.endLiveSession({
      classroomId: req.courseAccess.classroomId,
      sessionId: Number(req.params.sessionId),
    });

    await runQuery('UPDATE meetings SET is_active = 0 WHERE id = ?', [session.meeting_id]);
    await runQuery(
      `UPDATE meeting_participants
       SET left_at = CURRENT_TIMESTAMP
       WHERE room_id = ? AND left_at IS NULL`,
      [session.provider_room_id]
    );

    return res.json({
      message: 'Live session ended',
      liveSession: session,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to end live session');
  }
}

async function createAttendanceSession(req, res) {
  try {
    const session = await service.createAttendanceSession({
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title: req.body.title,
      sessionDate: req.body.sessionDate,
    });

    return res.status(201).json({
      message: 'Attendance session created',
      session,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create attendance session');
  }
}

async function listAttendanceSessions(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listAttendanceSessions({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list attendance sessions');
  }
}

async function markAttendance(req, res) {
  try {
    const rows = await service.markAttendance({
      attendanceSessionId: Number(req.params.sessionId),
      markedBy: req.user.id,
      records: req.body.records || [],
    });

    return res.json({
      message: 'Attendance marked',
      records: rows,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to mark attendance');
  }
}

async function listAttendanceRecords(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listAttendanceRecords({
      classroomId: req.courseAccess.classroomId,
      studentId: req.query.studentId ? Number(req.query.studentId) : null,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list attendance records');
  }
}

async function myAttendance(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listAttendanceRecords({
      classroomId: req.courseAccess.classroomId,
      studentId: req.user.id,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to load your attendance records');
  }
}

async function createGradeItem(req, res) {
  try {
    const gradeItem = await service.createGradeItem({
      classroomId: req.courseAccess.classroomId,
      userId: req.user.id,
      title: req.body.title,
      itemType: req.body.itemType,
      maxScore: req.body.maxScore,
      weightPercent: req.body.weightPercent,
    });

    return res.status(201).json({
      message: 'Grade item created',
      gradeItem,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create grade item');
  }
}

async function listGradeItems(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listGradeItems({
      classroomId: req.courseAccess.classroomId,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list grade items');
  }
}

async function upsertGradeEntries(req, res) {
  try {
    const rows = await service.upsertGradeEntries({
      gradeItemId: Number(req.params.gradeItemId),
      gradedBy: req.user.id,
      entries: req.body.entries || [],
    });

    return res.json({
      message: 'Grade entries saved',
      entries: rows,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to save grade entries');
  }
}

async function updateGradeEntry(req, res) {
  try {
    const entry = await service.updateGradeEntry({
      entryId: Number(req.params.entryId),
      score: req.body.score,
      feedback: req.body.feedback,
      gradedBy: req.user.id,
    });

    return res.json({
      message: 'Grade entry updated',
      entry,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update grade entry');
  }
}

async function myGrades(req, res) {
  try {
    const rows = await service.getStudentGradeView({
      classroomId: req.courseAccess.classroomId,
      studentId: req.user.id,
    });

    return res.json({
      grades: rows,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load your grades');
  }
}

async function listNotifications(req, res) {
  try {
    const { page, limit } = getPagination(req.query);
    const result = await service.listNotifications({
      userId: req.user.id,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to list notifications');
  }
}

async function unreadNotificationCount(req, res) {
  try {
    const unreadCount = await service.getUnreadNotificationCount(req.user.id);
    return res.json({ unreadCount });
  } catch (error) {
    return sendError(res, error, 'Failed to load unread notification count');
  }
}

async function markNotificationRead(req, res) {
  try {
    const notification = await service.markNotificationRead({
      userId: req.user.id,
      notificationId: Number(req.params.notificationId),
      isRead: req.body.isRead !== false,
    });

    return res.json({
      message: 'Notification updated',
      notification,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update notification');
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    const result = await service.markAllNotificationsRead({
      userId: req.user.id,
      isRead: req.body.isRead !== false,
    });

    return res.json({
      message: 'Notifications updated',
      ...result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update notifications');
  }
}

module.exports = {
  createCourse,
  listCourses,
  getCourse,
  updateCourse,
  archiveCourse,
  activateCourse,
  submitEnrollmentRequest,
  listEnrollmentRequests,
  approveEnrollmentRequest,
  rejectEnrollmentRequest,
  myEnrollments,
  getClassroom,
  listClassroomMembers,
  addAssistant,
  removeClassroomMember,
  createDiscussionThread,
  listDiscussionThreads,
  getDiscussionThread,
  updateDiscussionThread,
  deleteDiscussionThread,
  createDiscussionMessage,
  listDiscussionMessages,
  createNotice,
  listNotices,
  updateNotice,
  pinNotice,
  unpinNotice,
  deleteNotice,
  createExam: examHandlers.create,
  listExams: examHandlers.list,
  getExam: examHandlers.get,
  updateExam: examHandlers.update,
  publishExam: examHandlers.publish,
  closeExam: examHandlers.close,
  submitExam: examHandlers.submit,
  listExamSubmissions: examHandlers.submissions,
  createAssignment: assignmentHandlers.create,
  listAssignments: assignmentHandlers.list,
  getAssignment: assignmentHandlers.get,
  updateAssignment: assignmentHandlers.update,
  publishAssignment: assignmentHandlers.publish,
  closeAssignment: assignmentHandlers.close,
  submitAssignment: assignmentHandlers.submit,
  listAssignmentSubmissions: assignmentHandlers.submissions,
  createResource,
  listResources,
  deleteResource,
  createNote,
  listNotes,
  updateNote,
  deleteNote,
  createLiveSession,
  listLiveSessions,
  getLiveSession,
  joinLiveSession,
  endLiveSession,
  createAttendanceSession,
  listAttendanceSessions,
  markAttendance,
  listAttendanceRecords,
  myAttendance,
  createGradeItem,
  listGradeItems,
  upsertGradeEntries,
  updateGradeEntry,
  myGrades,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
};

