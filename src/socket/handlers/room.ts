// src/socket/handlers/room.ts
import { z } from 'zod';
import type { Socket } from 'socket.io';

import { logger } from '../../config';
import { rateLimitJoinRoom } from '../../middleware/rateLimiter';
import { createRouter, destroyRouter } from '../../sfu/router';
import { closeSocketMediaState } from '../state';
import type { ClientToServerEvents, Participant, ServerToClientEvents } from '../types';
import { getRoomMeta, setRoomMeta, cleanupRoom, applyRoomTtl } from '../../services/room.service';
import { getParticipant, listParticipants, removeParticipant, setParticipant } from '../../services/participant.service';
import { getIO } from '../server';

const joinRoomSchema = z.object({
  roomId: z.string().min(1),
  role: z.enum(['teacher', 'student']),
});

const endSessionSchema = z.object({
  roomId: z.string().min(1),
});

const emitParticipantList = async (roomId: string): Promise<void> => {
  const io = getIO();
  const participants = await listParticipants(roomId);
  io.to(roomId).emit('participant-list', { participants });
};

const handleLeave = async (
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  roomId: string,
): Promise<void> => {
  await removeParticipant(roomId, socket.id);
  closeSocketMediaState(socket.id);
  await emitParticipantList(roomId);

  logger.info({
    level: 'info',
    roomId,
    socketId: socket.id,
    event: 'leave-room',
    ts: new Date().toISOString(),
  });
};

export const registerRoomHandlers = (socket: Socket<ClientToServerEvents, ServerToClientEvents>): void => {
  socket.on('join-room', async (raw) => {
    try {
      const allowed = await rateLimitJoinRoom(socket.id);

      if (!allowed) {
        socket.emit('error', { code: 'RATE_LIMITED', message: 'join-room rate limit exceeded' });
        return;
      }

      const payload = joinRoomSchema.parse(raw);
      const user = socket.data.user;

      socket.join(payload.roomId);
      socket.data.roomId = payload.roomId;

      const participant: Participant = {
        socketId: socket.id,
        userId: user.userId,
        name: user.name,
        role: payload.role,
        isMuted: false,
        isCameraOff: false,
        hasHandRaised: false,
        roomId: payload.roomId,
      };

      await setParticipant(payload.roomId, participant);
      await applyRoomTtl(payload.roomId);

      if (payload.role === 'teacher') {
        await setRoomMeta(payload.roomId, {
          status: 'live',
        });

        await createRouter(payload.roomId);
      }

      await emitParticipantList(payload.roomId);

      socket.to(payload.roomId).emit('peer-joined', {
        socketId: socket.id,
        name: user.name,
        role: user.role,
      });

      logger.info({
        level: 'info',
        roomId: payload.roomId,
        socketId: socket.id,
        event: 'join-room',
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'JOIN_FAILED', message: 'Failed to join room' });
    }
  });

  socket.on('leave-room', async () => {
    try {
      const roomId = socket.data.roomId;

      if (!roomId) {
        return;
      }

      await handleLeave(socket, roomId);
      socket.leave(roomId);
      socket.data.roomId = undefined;
    } catch (_error: unknown) {
      socket.emit('error', { code: 'LEAVE_FAILED', message: 'Failed to leave room' });
    }
  });

  socket.on('end-session', async (raw) => {
    try {
      const payload = endSessionSchema.parse(raw);
      const user = socket.data.user;

      if (user.role !== 'teacher') {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Only teachers can end sessions' });
        return;
      }

      const meta = await getRoomMeta(payload.roomId);

      if (!meta) {
        socket.emit('error', { code: 'NOT_FOUND', message: 'Room not found' });
        return;
      }

      if (meta.teacherId !== user.userId) {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Only room teacher can end session' });
        return;
      }

      const io = getIO();
      io.to(payload.roomId).emit('session-ended');
      destroyRouter(payload.roomId);
      await cleanupRoom(payload.roomId);
    } catch (_error: unknown) {
      socket.emit('error', { code: 'END_FAILED', message: 'Failed to end session' });
    }
  });

  socket.on('disconnect', async () => {
    try {
      const roomId = socket.data.roomId;

      if (!roomId) {
        return;
      }

      await handleLeave(socket, roomId);
    } catch (_error: unknown) {
      // suppress disconnect errors
    }
  });
};

