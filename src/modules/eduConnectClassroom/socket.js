const jwt = require('jsonwebtoken');
const { runQuery } = require('../../../utils/eduSchema');
const { getJwtSecret } = require('../../../utils/security');
const { ensureClassroomSchema } = require('./schema/classroom.schema');

const JWT_SECRET = getJwtSecret();

function decodeUser(payload = {}, socket) {
  const token =
    payload.token ||
    socket?.handshake?.auth?.token ||
    (typeof socket?.handshake?.headers?.authorization === 'string'
      ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
      : null);

  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded && decoded.id ? decoded : null;
  } catch (_error) {
    return null;
  }
}

async function canAccessCourse(userId, courseId) {
  const rows = await runQuery(
    `SELECT
      c.id,
      CASE WHEN c.teacher_id = ? THEN 1 ELSE 0 END AS is_teacher,
      CASE WHEN EXISTS(
        SELECT 1
        FROM classrooms cl
        JOIN classroom_members cm ON cm.classroom_id = cl.id
        WHERE cl.course_id = c.id
          AND cm.user_id = ?
          AND cm.membership_role = 'student'
          AND cm.is_active = 1
          AND cm.removed_at IS NULL
      ) THEN 1 ELSE 0 END AS is_student_member,
      CASE WHEN EXISTS(
        SELECT 1
        FROM course_enrollment_requests cer
        WHERE cer.course_id = c.id
          AND cer.student_id = ?
          AND cer.status = 'approved'
      ) THEN 1 ELSE 0 END AS has_approved_enrollment
    FROM courses c
    WHERE c.id = ?
    LIMIT 1`,
    [userId, userId, userId, courseId]
  );

  if (!rows.length) {
    return { allowed: false, isTeacher: false };
  }

  const row = rows[0];
  const isTeacher = Boolean(row.is_teacher);
  const isStudent = Boolean(row.is_student_member) || Boolean(row.has_approved_enrollment);
  return {
    allowed: isTeacher || isStudent,
    isTeacher,
  };
}

function emitSocketError(socket, event, message) {
  socket.emit('socket-error', { event, message });
}

function registerClassroomSocket(io) {
  io.on('connection', async (socket) => {
    // Initial setup for global notifications
    const user = decodeUser({}, socket);
    if (user) {
      const userId = Number(user.id);
      socket.data.classroomUserId = userId;
      socket.data.classroomUserName = user.name || null;
      
      // Join personal room
      socket.join(`user-${userId}`);

      try {
        // Join all enrolled course rooms automatically
        const enrollments = await runQuery(
          `SELECT cl.course_id 
           FROM classroom_members cm 
           JOIN classrooms cl ON cl.id = cm.classroom_id 
           WHERE cm.user_id = ? AND cm.is_active = 1 AND cm.removed_at IS NULL`,
          [userId]
        );
        
        socket.data.classroomCourses = new Set();
        enrollments.forEach(e => {
          const room = String(e.course_id);
          socket.join(room);
          socket.data.classroomCourses.add(room);
        });
      } catch (err) {
        console.error('[Socket] Failed to auto-join rooms:', err);
      }
    }

    socket.on('join_classroom', async (payload = {}) => {
      try {
        await ensureClassroomSchema();

        const user = decodeUser(payload, socket);
        if (!user) {
          return emitSocketError(socket, 'join_classroom', 'Invalid or missing token');
        }

        const courseId = Number(payload.courseId);
        if (!Number.isInteger(courseId) || courseId <= 0) {
          return emitSocketError(socket, 'join_classroom', 'courseId must be a positive integer');
        }

        const access = await canAccessCourse(Number(user.id), courseId);
        if (!access.allowed) {
          return emitSocketError(socket, 'join_classroom', 'You are not a member of this classroom');
        }

        socket.data.classroomUserId = Number(user.id);
        socket.data.classroomUserName = user.name || null;
        socket.data.classroomCourses = socket.data.classroomCourses || new Set();
        socket.data.classroomCourses.add(String(courseId));

        socket.join(String(courseId));
        socket.emit('join_classroom_success', {
          courseId,
          userId: Number(user.id),
          name: user.name || null,
        });
      } catch (_error) {
        return emitSocketError(socket, 'join_classroom', 'Failed to join classroom');
      }
    });

    socket.on('typing', async (payload = {}) => {
      try {
        const courseId = Number(payload.courseId);
        if (!Number.isInteger(courseId) || courseId <= 0) {
          return emitSocketError(socket, 'typing', 'courseId must be a positive integer');
        }

        const userId = Number(socket.data.classroomUserId || 0);
        if (!userId) {
          return emitSocketError(socket, 'typing', 'Socket is not authenticated for classroom');
        }

        const joined = socket.data.classroomCourses && socket.data.classroomCourses.has(String(courseId));
        if (!joined) {
          return emitSocketError(socket, 'typing', 'Join classroom first');
        }

        socket.to(String(courseId)).emit('typing', {
          courseId,
          userId,
          name: socket.data.classroomUserName || null,
          isTyping: Boolean(payload.isTyping),
        });
      } catch (_error) {
        return emitSocketError(socket, 'typing', 'Failed to broadcast typing state');
      }
    });

    socket.on('send_message', async (payload = {}) => {
      try {
        const courseId = Number(payload.courseId);
        if (!Number.isInteger(courseId) || courseId <= 0) {
          return emitSocketError(socket, 'send_message', 'courseId must be a positive integer');
        }

        const userId = Number(socket.data.classroomUserId || 0);
        if (!userId) {
          return emitSocketError(socket, 'send_message', 'Socket is not authenticated for classroom');
        }

        const joined = socket.data.classroomCourses && socket.data.classroomCourses.has(String(courseId));
        if (!joined) {
          return emitSocketError(socket, 'send_message', 'Join classroom first');
        }

        const content = typeof payload.content === 'string' ? payload.content.trim() : '';
        const fileUrl = typeof payload.fileUrl === 'string' && payload.fileUrl.trim() ? payload.fileUrl.trim() : null;
        const fileType = typeof payload.fileType === 'string' && payload.fileType.trim() ? payload.fileType.trim() : null;

        if (!content && !fileUrl) {
          return emitSocketError(socket, 'send_message', 'Either content or fileUrl is required');
        }

        const insertResult = await runQuery(
          `INSERT INTO classroom_room_messages (course_id, sender_id, content, file_url, file_type, is_deleted)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [courseId, userId, content || null, fileUrl, fileType]
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
        io.to(String(courseId)).emit('send_message', {
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
        });
      } catch (_error) {
        return emitSocketError(socket, 'send_message', 'Failed to send classroom message');
      }
    });

    socket.on('message_deleted', async (payload = {}) => {
      try {
        const courseId = Number(payload.courseId);
        const messageId = Number(payload.messageId);
        if (!Number.isInteger(courseId) || courseId <= 0 || !Number.isInteger(messageId) || messageId <= 0) {
          return emitSocketError(socket, 'message_deleted', 'courseId and messageId must be positive integers');
        }

        const userId = Number(socket.data.classroomUserId || 0);
        if (!userId) {
          return emitSocketError(socket, 'message_deleted', 'Socket is not authenticated for classroom');
        }

        const joined = socket.data.classroomCourses && socket.data.classroomCourses.has(String(courseId));
        if (!joined) {
          return emitSocketError(socket, 'message_deleted', 'Join classroom first');
        }

        const [messageRows, access] = await Promise.all([
          runQuery(
            'SELECT id, sender_id, is_deleted FROM classroom_room_messages WHERE id = ? AND course_id = ? LIMIT 1',
            [messageId, courseId]
          ),
          canAccessCourse(userId, courseId),
        ]);

        if (!messageRows.length) {
          return emitSocketError(socket, 'message_deleted', 'Message not found');
        }

        const message = messageRows[0];
        const canDelete = Number(message.sender_id) === userId || access.isTeacher;
        if (!canDelete) {
          return emitSocketError(socket, 'message_deleted', 'Not allowed to delete this message');
        }

        if (!message.is_deleted) {
          await runQuery(
            'UPDATE classroom_room_messages SET is_deleted = 1, content = NULL, file_url = NULL, file_type = NULL WHERE id = ?',
            [messageId]
          );
        }

        io.to(String(courseId)).emit('message_deleted', {
          messageId,
          courseId,
          deletedBy: userId,
        });
      } catch (_error) {
        return emitSocketError(socket, 'message_deleted', 'Failed to delete message');
      }
    });
  });
}

module.exports = {
  registerClassroomSocket,
};

