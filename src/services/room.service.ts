// src/services/room.service.ts
import type { Namespace } from 'socket.io';

import { config, redis } from '../config';
import { destroyRouter } from '../sfu/router';
import type { ClientToServerEvents, RoomMeta, ServerToClientEvents } from '../socket/types';

const roomMetaKey = (roomId: string): string => `room:${roomId}:meta`;
const roomParticipantsKey = (roomId: string): string => `room:${roomId}:participants`;
const roomChatKey = (roomId: string): string => `room:${roomId}:chat`;

export const getRoomMetaKey = roomMetaKey;
export const getRoomParticipantsKey = roomParticipantsKey;
export const getRoomChatKey = roomChatKey;

export const setRoomMeta = async (roomId: string, payload: Record<string, string>): Promise<void> => {
  await redis.hset(roomMetaKey(roomId), payload);
  await redis.expire(roomMetaKey(roomId), config.ROOM_TTL_SECONDS);
};

export const getRoomMeta = async (roomId: string): Promise<RoomMeta | null> => {
  const meta = await redis.hgetall(roomMetaKey(roomId));

  if (!meta || Object.keys(meta).length === 0) {
    return null;
  }

  return {
    title: meta.title,
    teacherId: meta.teacherId,
    status: (meta.status as RoomMeta['status']) || 'waiting',
    createdAt: meta.createdAt,
    isRecording: meta.isRecording as RoomMeta['isRecording'] | undefined,
  };
};

export const cleanupRoom = async (
  roomId: string,
  io?: Namespace<ClientToServerEvents, ServerToClientEvents>,
): Promise<void> => {
  if (io) {
    io.to(roomId).emit('session-ended');
  }

  destroyRouter(roomId);

  const keys = [roomMetaKey(roomId), roomParticipantsKey(roomId), roomChatKey(roomId)];
  await redis.del(...keys);
};

export const applyRoomTtl = async (roomId: string): Promise<void> => {
  await redis.expire(roomMetaKey(roomId), config.ROOM_TTL_SECONDS);
  await redis.expire(roomParticipantsKey(roomId), config.ROOM_TTL_SECONDS);
  await redis.expire(roomChatKey(roomId), config.ROOM_TTL_SECONDS);
};

