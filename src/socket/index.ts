// src/socket/index.ts
import type { Server as HttpServer } from 'node:http';
import type { Producer, Router, Transport } from 'mediasoup/node/lib/types';
import { Namespace, Server as SocketServer } from 'socket.io';
import type { Server } from 'socket.io';
import type { Socket } from 'socket.io';

import { config, logger } from '../config';
import { socketAuthMiddleware } from '../middleware/auth';
import { getRouter } from '../sfu/router';
import { createWebRtcTransport } from '../sfu/transport';
import { registerClassroomHandlers } from './handlers/classroom';
import { registerRoomHandlers } from './handlers/room';
import { registerSignalingHandlers } from './handlers/signaling';
import { createIO, createNamespace, getIO, setIO } from './server';
import { ensureSocketMediaState, getSocketMediaState } from './state';
import type { ClientToServerEvents, ServerToClientEvents } from './types';

type TypedSocketServer = Server<ClientToServerEvents, ServerToClientEvents>;
void SocketServer;

const roomProducers = new Map<string, Map<string, Producer>>();

const getOrCreateRoomProducerMap = (roomId: string): Map<string, Producer> => {
  const existing = roomProducers.get(roomId);

  if (existing) {
    return existing;
  }

  const created = new Map<string, Producer>();
  roomProducers.set(roomId, created);
  return created;
};

const emitSocketError = (
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  code: string,
  message: string,
): void => {
  socket.emit('error', { code, message });
};

const validateRoomBinding = (
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  roomId: string,
): boolean => {
  return socket.data.roomId === roomId;
};

const isSocketServer = (
  value: HttpServer | TypedSocketServer,
): value is TypedSocketServer => {
  return typeof (value as TypedSocketServer).of === 'function';
};

const registerSfuHandlers = (socket: Socket<ClientToServerEvents, ServerToClientEvents>): void => {
  socket.on('get-rtp-capabilities', async (payload, callback) => {
    try {
      if (!validateRoomBinding(socket, payload.roomId)) {
        callback({ error: 'Socket is not bound to requested room' });
        return;
      }

      const router = getRouter(payload.roomId);
      callback({ rtpCapabilities: router.rtpCapabilities });

      logger.info({ level: 'info', roomId: payload.roomId, socketId: socket.id, event: 'get-rtp-capabilities', ts: new Date().toISOString() });
    } catch (_error: unknown) {
      callback({ error: 'Failed to get RTP capabilities' });
    }
  });

  socket.on('create-transport', async (payload, callback) => {
    try {
      if (!validateRoomBinding(socket, payload.roomId)) {
        callback({ error: 'Socket is not bound to requested room' });
        return;
      }

      const router = getRouter(payload.roomId);
      const { transport, params } = await createWebRtcTransport(router);

      const mediaState = ensureSocketMediaState(socket.id);
      mediaState.transports.set(transport.id, transport);

      callback(params);

      logger.info({ level: 'info', roomId: payload.roomId, socketId: socket.id, event: 'create-transport', ts: new Date().toISOString() });
    } catch (_error: unknown) {
      callback({ error: 'Failed to create transport' });
    }
  });

  socket.on('connect-transport', async (payload, callback) => {
    try {
      if (!validateRoomBinding(socket, payload.roomId)) {
        callback({ error: 'Socket is not bound to requested room' });
        return;
      }

      const mediaState = getSocketMediaState(socket.id);
      const transport = mediaState?.transports.get(payload.transportId);

      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }

      await transport.connect({
        dtlsParameters: payload.dtlsParameters as never,
      });

      callback({ ok: true });

      logger.info({ level: 'info', roomId: payload.roomId, socketId: socket.id, event: 'connect-transport', ts: new Date().toISOString() });
    } catch (_error: unknown) {
      callback({ error: 'Failed to connect transport' });
    }
  });

  socket.on('produce', async (payload, callback) => {
    try {
      if (!validateRoomBinding(socket, payload.roomId)) {
        callback({ error: 'Socket is not bound to requested room' });
        return;
      }

      const mediaState = getSocketMediaState(socket.id);
      const transport = mediaState?.transports.get(payload.transportId);

      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }

      const producer = await transport.produce({
        kind: payload.kind,
        rtpParameters: payload.rtpParameters as never,
      });

      ensureSocketMediaState(socket.id).producers.set(producer.id, producer);
      getOrCreateRoomProducerMap(payload.roomId).set(producer.id, producer);

      callback({ producerId: producer.id });

      logger.info({ level: 'info', roomId: payload.roomId, socketId: socket.id, event: 'produce', ts: new Date().toISOString() });
    } catch (_error: unknown) {
      callback({ error: 'Failed to produce' });
    }
  });

  socket.on('consume', async (payload, callback) => {
    try {
      if (!validateRoomBinding(socket, payload.roomId)) {
        callback({ error: 'Socket is not bound to requested room' });
        return;
      }

      const router: Router = getRouter(payload.roomId);

      if (!router.canConsume({
        producerId: payload.producerId,
        rtpCapabilities: payload.rtpCapabilities as never,
      })) {
        callback({ error: 'Cannot consume this producer with provided RTP capabilities' });
        return;
      }

      const mediaState = getSocketMediaState(socket.id);
      const transport = mediaState?.transports.get(payload.transportId);

      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }

      const producer = getOrCreateRoomProducerMap(payload.roomId).get(payload.producerId);

      if (!producer) {
        callback({ error: 'Producer not found' });
        return;
      }

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: payload.rtpCapabilities as never,
        paused: false,
      });

      ensureSocketMediaState(socket.id).consumers.set(consumer.id, consumer);

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });

      logger.info({ level: 'info', roomId: payload.roomId, socketId: socket.id, event: 'consume', ts: new Date().toISOString() });
    } catch (_error: unknown) {
      callback({ error: 'Failed to consume' });
    }
  });
};

export const initSocket = (
  target: HttpServer | TypedSocketServer,
): Namespace<ClientToServerEvents, ServerToClientEvents> => {
  if (isSocketServer(target)) {
    const namespace = createNamespace(target);
    bindSocketHandlers(namespace);
    return namespace;
  }

  createIO(target);
  const namespace = getIO();
  bindSocketHandlers(namespace);
  return namespace;
};

export const bindSocketHandlers = (io: Namespace<ClientToServerEvents, ServerToClientEvents>) => {
  setIO(io);
  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;

    if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) {
      next(new Error('Origin not allowed'));
      return;
    }

    next();
  });

  io.use(socketAuthMiddleware);

  io.on('connection', async (socket) => {
    try {
      registerSignalingHandlers(socket);
      registerRoomHandlers(socket);
      registerClassroomHandlers(socket);
      registerSfuHandlers(socket);

      logger.info({
        level: 'info',
        roomId: socket.data.roomId,
        socketId: socket.id,
        event: 'socket-connected',
        ts: new Date().toISOString(),
      });
    } catch (_error: unknown) {
      emitSocketError(socket, 'SOCKET_INIT_FAILED', 'Failed to initialize socket handlers');
    }
  });
};

export { getIO };

