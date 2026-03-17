// src/sfu/router.ts
import type { Router } from 'mediasoup/node/lib/types';

import { getWorker } from './worker';

const roomRouters = new Map<string, Router>();

export const createRouter = async (roomId: string): Promise<Router> => {
  if (roomRouters.has(roomId)) {
    return roomRouters.get(roomId)!;
  }

  const worker = getWorker();

  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
      },
    ],
  });

  roomRouters.set(roomId, router);
  return router;
};

export const getRouter = (roomId: string): Router => {
  const router = roomRouters.get(roomId);

  if (!router) {
    throw new Error(`Router not found for room: ${roomId}`);
  }

  return router;
};

export const destroyRouter = (roomId: string): void => {
  const router = roomRouters.get(roomId);

  if (!router) {
    return;
  }

  router.close();
  roomRouters.delete(roomId);
};

