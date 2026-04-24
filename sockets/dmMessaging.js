const jwt = require('jsonwebtoken');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');
const { getJwtSecret } = require('../utils/security');

const DM_RATE_LIMIT_WINDOW_MS = Number(process.env.DM_RATE_LIMIT_WINDOW_MS || 5000);
const DM_RATE_LIMIT_MAX_EVENTS = Number(process.env.DM_RATE_LIMIT_MAX_EVENTS || 60);

const dmRateBuckets = new Map();
const JWT_SECRET = getJwtSecret();

function isRateLimited(socketId, eventName) {
  const key = `${socketId}:${eventName}`;
  const now = Date.now();
  const bucket = dmRateBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= DM_RATE_LIMIT_WINDOW_MS) {
    dmRateBuckets.set(key, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > DM_RATE_LIMIT_MAX_EVENTS;
}

function emitSocketError(socket, eventName, message) {
  socket.emit('socket-error', { event: eventName, message });
}

function decodeTokenFromPayload(payload = {}) {
  const token = payload.token;
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required');
  }

  return jwt.verify(token, JWT_SECRET);
}

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function isUsersFriends(userAId, userBId) {
  const [u1, u2] = orderedPair(Number(userAId), Number(userBId));
  const rows = await runQuery('SELECT id FROM edu_friendships WHERE user1_id = ? AND user2_id = ? LIMIT 1', [u1, u2]);
  return rows.length > 0;
}

async function getOrCreateDmConversation(userAId, userBId) {
  const [u1, u2] = orderedPair(Number(userAId), Number(userBId));

  const existing = await runQuery(
    `SELECT id, user1_id, user2_id, created_at
     FROM edu_dm_conversations
     WHERE user1_id = ? AND user2_id = ?
     LIMIT 1`,
    [u1, u2]
  );

  if (existing.length) {
    return existing[0];
  }

  await runQuery('INSERT IGNORE INTO edu_dm_conversations (user1_id, user2_id) VALUES (?, ?)', [u1, u2]);

  const rows = await runQuery(
    `SELECT id, user1_id, user2_id, created_at
     FROM edu_dm_conversations
     WHERE user1_id = ? AND user2_id = ?
     LIMIT 1`,
    [u1, u2]
  );

  return rows[0] || null;
}

async function hydrateMessageById(messageId) {
  const rows = await runQuery(
    `SELECT
       m.id,
       m.conversation_id,
       m.sender_id,
       m.receiver_id,
       m.message_text,
       m.is_read,
       m.created_at,
       su.name AS sender_name,
       su.profile_pic_url AS sender_profile_pic_url,
       ru.name AS receiver_name,
       ru.profile_pic_url AS receiver_profile_pic_url
     FROM edu_dm_messages m
     JOIN edu_users su ON su.id = m.sender_id
     JOIN edu_users ru ON ru.id = m.receiver_id
     WHERE m.id = ?
     LIMIT 1`,
    [messageId]
  );

  return rows[0] || null;
}

async function hydrateCourseMessageById(messageId) {
  const rows = await runQuery(
    `SELECT
       m.id,
       m.course_id,
       m.sender_id,
       m.content AS message_text,
       m.created_at,
       su.name AS sender_name,
       su.profile_pic_url AS sender_profile_pic_url
     FROM classroom_room_messages m
     JOIN edu_users su ON su.id = m.sender_id
     WHERE m.id = ?
     LIMIT 1`,
    [messageId]
  );
  return rows[0] || null;
}

async function isCourseMember(userId, courseId) {
  const rows = await runQuery(
    `SELECT cm.id FROM classroom_members cm
     JOIN classrooms cl ON cl.id = cm.classroom_id
     WHERE cl.course_id = ? AND cm.user_id = ? AND cm.is_active = 1 AND cm.removed_at IS NULL
     LIMIT 1`,
    [courseId, userId]
  );
  return rows.length > 0;
}

function registerDMMessaging(io) {
  io.on('connection', (socket) => {
    socket.on('dm-auth', async (payload = {}) => {
      try {
        if (isRateLimited(socket.id, 'dm-auth')) {
          return emitSocketError(socket, 'dm-auth', 'Rate limit exceeded');
        }

        await ensureEduSchema();

        let user;
        try {
          user = decodeTokenFromPayload(payload);
        } catch (_) {
          return emitSocketError(socket, 'dm-auth', 'Invalid or expired token');
        }

        socket.data.dmUserId = Number(user.id);
        socket.data.dmUserName = user.name || null;
        socket.join(`dm-user-${user.id}`);

        return socket.emit('dm-auth-success', {
          userId: Number(user.id),
          name: user.name || null,
        });
      } catch (error) {
        return emitSocketError(socket, 'dm-auth', 'Failed to initialize DM socket');
      }
    });

    socket.on('dm-join-group', async (payload = {}) => {
      try {
        if (isRateLimited(socket.id, 'dm-join-group')) {
          return emitSocketError(socket, 'dm-join-group', 'Rate limit exceeded');
        }
        const userId = Number(socket.data.dmUserId);
        if (!userId) return emitSocketError(socket, 'dm-join-group', 'Socket is not authenticated');

        const groupId = payload.groupId;
        if (!groupId || !groupId.startsWith('course-')) {
          return emitSocketError(socket, 'dm-join-group', 'Invalid groupId');
        }

        const courseId = Number(groupId.replace('course-', ''));
        const isMember = await isCourseMember(userId, courseId);
        if (!isMember) {
          return emitSocketError(socket, 'dm-join-group', 'You are not a member of this course');
        }

        socket.join(groupId);
        socket.emit('dm-joined-group', { groupId });
      } catch (error) {
        emitSocketError(socket, 'dm-join-group', 'Failed to join group');
      }
    });

    socket.on('dm-send', async (payload = {}) => {
      try {
        if (isRateLimited(socket.id, 'dm-send')) {
          return emitSocketError(socket, 'dm-send', 'Rate limit exceeded');
        }

        const senderId = Number(socket.data.dmUserId);
        if (!senderId) {
          return emitSocketError(socket, 'dm-send', 'Socket is not authenticated for DM');
        }

        const receiverId = Number(payload.receiverId);
        const messageText = (payload.messageText || '').toString().trim();

        if (payload.groupId && payload.groupId.startsWith('course-')) {
          if (!messageText) return emitSocketError(socket, 'dm-send', 'messageText is required');
          const courseId = Number(payload.groupId.replace('course-', ''));
          const isMember = await isCourseMember(senderId, courseId);
          if (!isMember) return emitSocketError(socket, 'dm-send', 'You are not a member of this course');

          const insertResult = await runQuery(
            `INSERT INTO classroom_room_messages (course_id, sender_id, content) VALUES (?, ?, ?)`,
            [courseId, senderId, messageText]
          );

          const dmMessage = await hydrateCourseMessageById(insertResult.insertId);
          dmMessage.groupId = payload.groupId;
          
          io.to(payload.groupId).emit('group-message', { message: dmMessage, groupId: payload.groupId });
          return;
        }

        const receiverId = Number(payload.receiverId);
        if (!receiverId) {
          return emitSocketError(socket, 'dm-send', 'receiverId or groupId is required');
        }

        if (receiverId === senderId) {
          return emitSocketError(socket, 'dm-send', 'Cannot send DM to yourself');
        }

        if (!messageText) {
          return emitSocketError(socket, 'dm-send', 'messageText is required');
        }

        const [receiverRows, isFriend] = await Promise.all([
          runQuery('SELECT id FROM edu_users WHERE id = ? LIMIT 1', [receiverId]),
          isUsersFriends(senderId, receiverId),
        ]);

        if (!receiverRows.length) {
          return emitSocketError(socket, 'dm-send', 'Receiver not found');
        }

        if (!isFriend) {
          return emitSocketError(socket, 'dm-send', 'You can only message users in your friend list');
        }

        const conversation = await getOrCreateDmConversation(senderId, receiverId);
        if (!conversation) {
          return emitSocketError(socket, 'dm-send', 'Failed to create conversation');
        }

        const insertResult = await runQuery(
          `INSERT INTO edu_dm_messages (conversation_id, sender_id, receiver_id, message_text)
           VALUES (?, ?, ?, ?)`,
          [conversation.id, senderId, receiverId, messageText]
        );

        const dmMessage = await hydrateMessageById(insertResult.insertId);
        if (!dmMessage) {
          return emitSocketError(socket, 'dm-send', 'Failed to load saved message');
        }

        io.to(`dm-user-${senderId}`).emit('dm-message', { message: dmMessage });
        io.to(`dm-user-${receiverId}`).emit('dm-message', { message: dmMessage });
      } catch (error) {
        emitSocketError(socket, 'dm-send', 'Failed to send DM message');
      }
    });

    socket.on('dm-mark-read', async (payload = {}) => {
      try {
        if (isRateLimited(socket.id, 'dm-mark-read')) {
          return emitSocketError(socket, 'dm-mark-read', 'Rate limit exceeded');
        }

        const readerId = Number(socket.data.dmUserId);
        if (!readerId) {
          return emitSocketError(socket, 'dm-mark-read', 'Socket is not authenticated for DM');
        }

        const messageId = Number(payload.messageId);
        if (!messageId) {
          return emitSocketError(socket, 'dm-mark-read', 'messageId is required');
        }

        const rows = await runQuery(
          `SELECT id, conversation_id, sender_id, receiver_id, is_read
           FROM edu_dm_messages
           WHERE id = ?
           LIMIT 1`,
          [messageId]
        );

        if (!rows.length) {
          return emitSocketError(socket, 'dm-mark-read', 'Message not found');
        }

        const dm = rows[0];
        if (Number(dm.receiver_id) !== readerId) {
          return emitSocketError(socket, 'dm-mark-read', 'Only receiver can mark this message as read');
        }

        if (!dm.is_read) {
          await runQuery('UPDATE edu_dm_messages SET is_read = 1 WHERE id = ?', [messageId]);
        }

        const readPayload = {
          messageId,
          conversationId: dm.conversation_id,
          readerId,
          readAt: new Date().toISOString(),
        };

        io.to(`dm-user-${dm.sender_id}`).emit('dm-message-read', readPayload);
        io.to(`dm-user-${dm.receiver_id}`).emit('dm-message-read', readPayload);
      } catch (error) {
        emitSocketError(socket, 'dm-mark-read', 'Failed to mark message as read');
      }
    });
  });
}

module.exports = {
  registerDMMessaging,
};

