// src/socket/handlers/signaling.ts
import { z } from 'zod';
import type { Socket } from 'socket.io';

import { logger } from '../../config';
import { getIO } from '../server';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';

const offerSchema = z.object({
  to: z.string().min(1),
  sdp: z.object({}).passthrough(),
});

const answerSchema = z.object({
  to: z.string().min(1),
  sdp: z.object({}).passthrough(),
});

const iceSchema = z.object({
  to: z.string().min(1),
  candidate: z.object({}).passthrough(),
});

const getTargetSocket = (targetSocketId: string) => {
  const io = getIO();
  return io.sockets.get(targetSocketId);
};

export const registerSignalingHandlers = (
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
): void => {
  socket.on('offer', (raw) => {
    try {
      const payload = offerSchema.parse(raw);
      const targetSocket = getTargetSocket(payload.to);

      if (!targetSocket) {
        socket.emit('error', { code: 'TARGET_NOT_FOUND', message: 'Target socket not found' });
        return;
      }

      if (!socket.data.roomId || targetSocket.data.roomId !== socket.data.roomId) {
        socket.emit('error', { code: 'ROOM_MISMATCH', message: 'Target socket is not in the same room' });
        return;
      }

      targetSocket.emit('offer', {
        from: socket.id,
        sdp: payload.sdp as unknown as RTCSessionDescriptionInit,
      });

      logger.info({
        level: 'info',
        event: 'offer',
        socketId: socket.id,
        roomId: socket.data.roomId,
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'INVALID_OFFER', message: 'Invalid offer payload' });
    }
  });

  socket.on('answer', (raw) => {
    try {
      const payload = answerSchema.parse(raw);
      const targetSocket = getTargetSocket(payload.to);

      if (!targetSocket) {
        socket.emit('error', { code: 'TARGET_NOT_FOUND', message: 'Target socket not found' });
        return;
      }

      if (!socket.data.roomId || targetSocket.data.roomId !== socket.data.roomId) {
        socket.emit('error', { code: 'ROOM_MISMATCH', message: 'Target socket is not in the same room' });
        return;
      }

      targetSocket.emit('answer', {
        from: socket.id,
        sdp: payload.sdp as unknown as RTCSessionDescriptionInit,
      });

      logger.info({
        level: 'info',
        event: 'answer',
        socketId: socket.id,
        roomId: socket.data.roomId,
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'INVALID_ANSWER', message: 'Invalid answer payload' });
    }
  });

  socket.on('ice-candidate', (raw) => {
    try {
      const payload = iceSchema.parse(raw);
      const targetSocket = getTargetSocket(payload.to);

      if (!targetSocket) {
        socket.emit('error', { code: 'TARGET_NOT_FOUND', message: 'Target socket not found' });
        return;
      }

      if (!socket.data.roomId || targetSocket.data.roomId !== socket.data.roomId) {
        socket.emit('error', { code: 'ROOM_MISMATCH', message: 'Target socket is not in the same room' });
        return;
      }

      targetSocket.emit('ice-candidate', { from: socket.id, candidate: payload.candidate as RTCIceCandidateInit });

      logger.info({
        level: 'info',
        event: 'ice-candidate',
        socketId: socket.id,
        roomId: socket.data.roomId,
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      socket.emit('error', { code: 'INVALID_ICE', message: 'Invalid ice-candidate payload' });
    }
  });
};

