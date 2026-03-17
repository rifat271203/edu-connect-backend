// src/shutdown.ts
import type { Server as HttpServer } from 'node:http';

import { redis } from './config';
import { closeAllWorkers } from './sfu/worker';

export const shutdown = async (httpServer: HttpServer): Promise<void> => {
  await closeAllWorkers();
  await redis.quit();

  await new Promise<void>((resolve, reject) => {
    httpServer.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

