const jwt = require('jsonwebtoken');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');
const { getJwtSecret } = require('../utils/security');

const SIGNAL_RATE_LIMIT_WINDOW_MS = Number(process.env.SIGNAL_RATE_LIMIT_WINDOW_MS || 5000);
const SIGNAL_RATE_LIMIT_MAX_EVENTS = Number(process.env.SIGNAL_RATE_LIMIT_MAX_EVENTS || 40);

const eventRateBuckets = new Map();
const JWT_SECRET = getJwtSecret();

function isRateLimited(socketId, eventName) {
  const key = `${socketId}:${eventName}`;
  const now = Date.now();
  const bucket = eventRateBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= SIGNAL_RATE_LIMIT_WINDOW_MS) {
    eventRateBuckets.set(key, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  if (bucket.count > SIGNAL_RATE_LIMIT_MAX_EVENTS) {
    return true;
  }

  return false;
}

function emitSocketError(socket, eventName, message) {
  socket.emit('socket-error', { event: eventName, message });
}

function getTargetSocketInRoom(io, roomId, toSocketId) {
  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets || !roomSockets.has(toSocketId)) {
    return null;
  }

  const targetSocket = io.sockets.sockets.get(toSocketId);
  if (!targetSocket || targetSocket.data.roomId !== roomId) {
    return null;
  }

  return targetSocket;
}

function decodeTokenFromPayload(payload = {}) {
  const token = payload.token;
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required');
  }

  return jwt.verify(token, JWT_SECRET);
}

async function getMeetingByRoomId(roomId) {
  const rows = await runQuery('SELECT id, room_id, host_user_id, is_active FROM meetings WHERE room_id = ? LIMIT 1', [roomId]);
  return rows[0] || null;
}

async function markParticipantLeft(roomId, userId) {
  if (!roomId || !userId) return;

  await runQuery(
    `UPDATE meeting_participants
     SET left_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM (
         SELECT id
         FROM meeting_participants
         WHERE room_id = ? AND user_id = ? AND left_at IS NULL
         ORDER BY joined_at DESC
         LIMIT 1
       ) latest
     )`,
    [roomId, userId]
  );
}

function registerMeetingSignaling(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', async (payload = {}) => {
      try {
        if (isRateLimited(socket.id, 'join-room')) {
          return emitSocketError(socket, 'join-room', 'Rate limit exceeded');
        }

        await ensureEduSchema();

        const { roomId } = payload;
        if (!roomId || typeof roomId !== 'string') {
          return emitSocketError(socket, 'join-room', 'roomId is required');
        }

        let user;
        try {
          user = decodeTokenFromPayload(payload);
        } catch (tokenError) {
          return emitSocketError(socket, 'join-room', 'Invalid or expired token');
        }

        const meeting = await getMeetingByRoomId(roomId);
        if (!meeting) {
          return emitSocketError(socket, 'join-room', 'Meeting room not found');
        }

        if (!meeting.is_active) {
          return emitSocketError(socket, 'join-room', 'Meeting is not active');
        }

        if (socket.data.roomId && socket.data.userId) {
          await markParticipantLeft(socket.data.roomId, socket.data.userId);
          socket.leave(socket.data.roomId);
          socket.to(socket.data.roomId).emit('user-left', {
            socketId: socket.id,
            userId: socket.data.userId,
          });
        }

        await runQuery('INSERT INTO meeting_participants (room_id, user_id) VALUES (?, ?)', [roomId, user.id]);

        socket.data.roomId = roomId;
        socket.data.userId = user.id;
        socket.data.name = user.name || null;
        socket.data.meetingId = meeting.id;

        const roomSockets = io.sockets.adapter.rooms.get(roomId) || new Set();
        const peers = [];

        roomSockets.forEach((socketId) => {
          const peerSocket = io.sockets.sockets.get(socketId);
          if (!peerSocket || socketId === socket.id) return;
          if (!peerSocket.data || Number(peerSocket.data.userId) <= 0) return;

          peers.push({
            socketId,
            userId: peerSocket.data.userId,
            name: peerSocket.data.name || null,
          });
        });

        socket.join(roomId);
        socket.emit('room-users', peers);
        socket.to(roomId).emit('user-joined', {
          socketId: socket.id,
          userId: user.id,
          name: user.name || null,
        });
      } catch (error) {
        emitSocketError(socket, 'join-room', 'Failed to join room');
      }
    });

    socket.on('offer', async (payload = {}) => {
      if (isRateLimited(socket.id, 'offer')) {
        return emitSocketError(socket, 'offer', 'Rate limit exceeded');
      }

      const { roomId, toSocketId, offer } = payload;
      if (!roomId || !toSocketId || offer === undefined) {
        return emitSocketError(socket, 'offer', 'roomId, toSocketId and offer are required');
      }

      if (socket.data.roomId !== roomId) {
        return emitSocketError(socket, 'offer', 'Socket is not joined to this room');
      }

      const targetSocket = getTargetSocketInRoom(io, roomId, toSocketId);
      if (!targetSocket) {
        return emitSocketError(socket, 'offer', 'Target socket is not available in this room');
      }

      targetSocket.emit('offer', {
        fromSocketId: socket.id,
        offer,
        userId: socket.data.userId || null,
        name: socket.data.name || null,
      });
    });

    socket.on('answer', (payload = {}) => {
      if (isRateLimited(socket.id, 'answer')) {
        return emitSocketError(socket, 'answer', 'Rate limit exceeded');
      }

      const { roomId, toSocketId, answer } = payload;
      if (!roomId || !toSocketId || answer === undefined) {
        return emitSocketError(socket, 'answer', 'roomId, toSocketId and answer are required');
      }

      if (socket.data.roomId !== roomId) {
        return emitSocketError(socket, 'answer', 'Socket is not joined to this room');
      }

      const targetSocket = getTargetSocketInRoom(io, roomId, toSocketId);
      if (!targetSocket) {
        return emitSocketError(socket, 'answer', 'Target socket is not available in this room');
      }

      targetSocket.emit('answer', {
        fromSocketId: socket.id,
        answer,
      });
    });

    socket.on('ice-candidate', (payload = {}) => {
      if (isRateLimited(socket.id, 'ice-candidate')) {
        return emitSocketError(socket, 'ice-candidate', 'Rate limit exceeded');
      }

      const { roomId, toSocketId, candidate } = payload;
      if (!roomId || !toSocketId || candidate === undefined) {
        return emitSocketError(socket, 'ice-candidate', 'roomId, toSocketId and candidate are required');
      }

      if (socket.data.roomId !== roomId) {
        return emitSocketError(socket, 'ice-candidate', 'Socket is not joined to this room');
      }

      const targetSocket = getTargetSocketInRoom(io, roomId, toSocketId);
      if (!targetSocket) {
        return emitSocketError(socket, 'ice-candidate', 'Target socket is not available in this room');
      }

      targetSocket.emit('ice-candidate', {
        fromSocketId: socket.id,
        candidate,
      });
    });

    socket.on('leave-room', async () => {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (!roomId || !userId) return;

      await markParticipantLeft(roomId, userId);
      socket.leave(roomId);

      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        userId,
      });

      socket.data.roomId = null;
      socket.data.userId = null;
      socket.data.name = null;
      socket.data.meetingId = null;
    });

    socket.on('disconnect', async () => {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      if (!roomId || !userId) return;

      try {
        await markParticipantLeft(roomId, userId);
      } catch (_) {
        // no-op
      }

      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        userId,
      });
    });
  });
}

module.exports = {
  registerMeetingSignaling,
};
