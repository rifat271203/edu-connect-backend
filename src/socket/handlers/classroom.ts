// src/socket/handlers/classroom.ts
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { Socket } from 'socket.io';

import { config, logger, redis } from '../../config';
import { rateLimitChat } from '../../middleware/rateLimiter';
import type { ClientToServerEvents, ChatMessage, Participant, ServerToClientEvents } from '../types';
import { listParticipants, getParticipant, setParticipant } from '../../services/participant.service';
import { applyRoomTtl } from '../../services/room.service';

const handRaiseSchema = z.object({
  raised: z.boolean(),
});

const sendChatSchema = z.object({
  message: z.string().min(1).max(500),
});

const muteParticipantSchema = z.object({
  targetId: z.string().min(1),
});

const admitStudentSchema = z.object({
  socketId: z.string().min(1),
});

const getRoomId = (socket: Socket<ClientToServerEvents, ServerToClientEvents>): string | null => {
  return socket.data.roomId ?? null;
};

const emitParticipants = async (roomId: string, socket: Socket<ClientToServerEvents, ServerToClientEvents>): Promise<void> => {
  const participants = await listParticipants(roomId);
  socket.to(roomId).emit('participant-list', { participants });
  socket.emit('participant-list', { participants });
};

export const registerClassroomHandlers = (
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
): void => {
  socket.on('hand-raise', async (raw) => {
    try {
      const payload = handRaiseSchema.parse(raw);
      const roomId = getRoomId(socket);

      if (!roomId) {
        socket.emit('error', { code: 'ROOM_REQUIRED', message: 'Join a room first' });
        return;
      }

      const participant = await getParticipant(roomId, socket.id);

      if (!participant) {
        socket.emit('error', { code: 'PARTICIPANT_NOT_FOUND', message: 'Participant not found in room' });
        return;
      }

      const updated: Participant = {
        ...participant,
        hasHandRaised: payload.raised,
      };

      await setParticipant(roomId, updated);

      socket.to(roomId).emit('hand-raised', {
        socketId: socket.id,
        name: updated.name,
        raised: payload.raised,
      });

      socket.emit('hand-raised', {
        socketId: socket.id,
        name: updated.name,
        raised: payload.raised,
      });

      logger.info({
        level: 'info',
        roomId,
        socketId: socket.id,
        event: 'hand-raise',
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'HAND_RAISE_FAILED', message: 'Failed to process hand raise' });
    }
  });

  socket.on('send-chat', async (raw) => {
    try {
      const allowed = await rateLimitChat(socket.id);

      if (!allowed) {
        socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many chat messages' });
        return;
      }

      const payload = sendChatSchema.parse(raw);
      const roomId = getRoomId(socket);

      if (!roomId) {
        socket.emit('error', { code: 'ROOM_REQUIRED', message: 'Join a room first' });
        return;
      }

      const message: ChatMessage = {
        id: nanoid(),
        senderId: socket.data.user.userId,
        senderName: socket.data.user.name,
        message: payload.message,
        timestamp: new Date().toISOString(),
      };

      const key = `room:${roomId}:chat`;
      await redis.lpush(key, JSON.stringify(message));
      await redis.ltrim(key, 0, 199);
      await applyRoomTtl(roomId);

      socket.to(roomId).emit('chat-message', {
        senderId: message.senderId,
        senderName: message.senderName,
        message: message.message,
        timestamp: message.timestamp,
      });

      socket.emit('chat-message', {
        senderId: message.senderId,
        senderName: message.senderName,
        message: message.message,
        timestamp: message.timestamp,
      });

      logger.info({
        level: 'info',
        roomId,
        socketId: socket.id,
        event: 'send-chat',
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'CHAT_FAILED', message: 'Failed to send chat message' });
    }
  });

  socket.on('mute-participant', async (raw) => {
    try {
      if (socket.data.user.role !== 'teacher') {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Only teachers can mute participants' });
        return;
      }

      const payload = muteParticipantSchema.parse(raw);
      const roomId = getRoomId(socket);

      if (!roomId) {
        socket.emit('error', { code: 'ROOM_REQUIRED', message: 'Join a room first' });
        return;
      }

      const participant = await getParticipant(roomId, payload.targetId);

      if (!participant) {
        socket.emit('error', { code: 'PARTICIPANT_NOT_FOUND', message: 'Target participant not found' });
        return;
      }

      await setParticipant(roomId, {
        ...participant,
        isMuted: true,
      });

      socket.to(payload.targetId).emit('force-mute');

      logger.info({
        level: 'info',
        roomId,
        socketId: socket.id,
        event: 'mute-participant',
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'MUTE_FAILED', message: 'Failed to mute participant' });
    }
  });

  socket.on('admit-student', async (raw) => {
    try {
      if (socket.data.user.role !== 'teacher') {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Only teachers can admit students' });
        return;
      }

      const payload = admitStudentSchema.parse(raw);
      const roomId = getRoomId(socket);

      if (!roomId) {
        socket.emit('error', { code: 'ROOM_REQUIRED', message: 'Join a room first' });
        return;
      }

      const participant = await getParticipant(roomId, payload.socketId);

      if (!participant) {
        socket.emit('error', { code: 'PARTICIPANT_NOT_FOUND', message: 'Target participant not found' });
        return;
      }

      await setParticipant(roomId, {
        ...participant,
        isAdmitted: true,
      });

      socket.to(payload.socketId).emit('admitted');
      await emitParticipants(roomId, socket);

      logger.info({
        level: 'info',
        roomId,
        socketId: socket.id,
        event: 'admit-student',
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'ADMIT_FAILED', message: 'Failed to admit student' });
    }
  });
};

