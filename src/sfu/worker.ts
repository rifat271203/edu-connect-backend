// src/sfu/worker.ts
import { createWorker } from 'mediasoup';
import type { Worker } from 'mediasoup/node/lib/types';

import { logger } from '../config';

const workers: Worker[] = [];
let workerIndex = 0;

export const initWorkers = async (): Promise<void> => {
  if (workers.length > 0) {
    return;
  }

  const count = 2;

  for (let i = 0; i < count; i += 1) {
    const worker = await createWorker({
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'warn',
    });

    worker.on('died', () => {
      logger.error({ level: 'error', event: 'mediasoup-worker-died', workerPid: worker.pid, ts: new Date().toISOString() });
    });

    workers.push(worker);
  }
};

export const getWorker = (): Worker => {
  if (workers.length === 0) {
    throw new Error('No mediasoup workers initialized. Call initWorkers() first.');
  }

  const worker = workers[workerIndex % workers.length];
  workerIndex += 1;
  return worker;
};

export const closeAllWorkers = async (): Promise<void> => {
  await Promise.all(
    workers.map(async (worker) => {
      worker.close();
    }),
  );

  workers.length = 0;
  workerIndex = 0;
};

