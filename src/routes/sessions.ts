// src/routes/sessions.ts
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { config, logger, redis } from '../config';
import { authMiddleware } from '../middleware/auth';
import { applyRoomTtl, cleanupRoom, getRoomChatKey, getRoomMeta, getRoomMetaKey, getRoomParticipantsKey, setRoomMeta } from '../services/room.service';
import { getIO } from '../socket/server';
import type { ChatMessage } from '../socket/types';

const createSessionSchema = z.object({
  title: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
});

const sessionRouter = Router();

sessionRouter.use(authMiddleware);

sessionRouter.post('/', async (req, res) => {
  try {
    if (req.user?.role !== 'teacher') {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only teachers can create sessions' });
      return;
    }

    const parsed = createSessionSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }

    const roomId = nanoid(10);
    const now = new Date().toISOString();

    await setRoomMeta(roomId, {
      title: parsed.data.title,
      teacherId: req.user.userId,
      status: 'waiting',
      createdAt: now,
      isRecording: 'false',
      ...(parsed.data.scheduledAt ? { scheduledAt: parsed.data.scheduledAt } : {}),
    });

    await applyRoomTtl(roomId);

    res.status(201).json({
      roomId,
      joinUrl: `https://edu-connect-frontend-three.vercel.app/classroom/${roomId}`,
      title: parsed.data.title,
    });
  } catch (error: unknown) {
    logger.error({ level: 'error', event: 'create-session-failed', message: error instanceof Error ? error.message : 'Unknown error', ts: new Date().toISOString() });
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to create session' });
  }
});

sessionRouter.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const meta = await getRoomMeta(roomId);

    if (!meta) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Room not found' });
      return;
    }

    const participantCount = await redis.hlen(getRoomParticipantsKey(roomId));

    res.json({
      roomId,
      title: meta.title,
      status: meta.status,
      participantCount,
      isRecording: meta.isRecording === 'true',
    });
  } catch (_error: unknown) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to fetch session' });
  }
});

sessionRouter.post('/:roomId/end', async (req, res) => {
  try {
    if (req.user?.role !== 'teacher') {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only teachers can end sessions' });
      return;
    }

    const { roomId } = req.params;
    const meta = await getRoomMeta(roomId);

    if (!meta) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Room not found' });
      return;
    }

    if (meta.teacherId !== req.user.userId) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'You are not the session owner' });
      return;
    }

    const io = getIO();
    await cleanupRoom(roomId, io);

    res.json({ success: true });
  } catch (_error: unknown) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to end session' });
  }
});

sessionRouter.get('/:roomId/chat', async (req, res) => {
  try {
    const { roomId } = req.params;
    const key = getRoomChatKey(roomId);

    const rawMessages = await redis.lrange(key, 0, 99);
    const messages: ChatMessage[] = rawMessages
      .map((item) => {
        try {
          return JSON.parse(item) as ChatMessage;
        } catch (_error: unknown) {
          return null;
        }
      })
      .filter((item): item is ChatMessage => item !== null);

    res.json({ messages });
  } catch (_error: unknown) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to fetch chat history' });
  }
});

export { sessionRouter };
export default sessionRouter;

