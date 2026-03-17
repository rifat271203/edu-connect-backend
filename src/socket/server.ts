// src/socket/server.ts
import type { Server as HttpServer } from 'node:http';
import { Namespace, Server } from 'socket.io';

import { config } from '../config';
import type { ClientToServerEvents, ServerToClientEvents } from './types';

let ioInstance: Namespace<ClientToServerEvents, ServerToClientEvents> | null = null;

export const setIO = (io: Namespace<ClientToServerEvents, ServerToClientEvents>): void => {
  ioInstance = io;
};

export const getIO = (): Namespace<ClientToServerEvents, ServerToClientEvents> => {
  if (!ioInstance) {
    throw new Error('Socket.io server has not been initialized');
  }

  return ioInstance;
};

export const createNamespace = (
  io: Server,
  namespace = '/classroom',
): Namespace<ClientToServerEvents, ServerToClientEvents> => {
  const nsp = io.of(namespace);
  setIO(nsp);
  return nsp;
};

export const createIO = (httpServer: HttpServer): Server<ClientToServerEvents, ServerToClientEvents> => {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: config.ALLOWED_ORIGINS,
      credentials: true,
    },
  });

  createNamespace(io);
  return io;
};

