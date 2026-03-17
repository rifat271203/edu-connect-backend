// src/socket/state.ts
import type { Consumer, Producer, Transport } from 'mediasoup/node/lib/types';

export interface SocketMediaState {
  transports: Map<string, Transport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

const mediaStateBySocket = new Map<string, SocketMediaState>();

export const ensureSocketMediaState = (socketId: string): SocketMediaState => {
  const existing = mediaStateBySocket.get(socketId);

  if (existing) {
    return existing;
  }

  const created: SocketMediaState = {
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };

  mediaStateBySocket.set(socketId, created);
  return created;
};

export const getSocketMediaState = (socketId: string): SocketMediaState | undefined => {
  return mediaStateBySocket.get(socketId);
};

export const closeSocketMediaState = (socketId: string): void => {
  const state = mediaStateBySocket.get(socketId);

  if (!state) {
    return;
  }

  state.consumers.forEach((consumer) => consumer.close());
  state.producers.forEach((producer) => producer.close());
  state.transports.forEach((transport) => transport.close());

  mediaStateBySocket.delete(socketId);
};

