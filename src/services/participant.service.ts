// src/services/participant.service.ts
import { config, redis } from '../config';
import type { Participant } from '../socket/types';
import { getRoomParticipantsKey } from './room.service';

const parseParticipant = (raw: string | null): Participant | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Participant;
  } catch (_error: unknown) {
    return null;
  }
};

export const getParticipant = async (roomId: string, socketId: string): Promise<Participant | null> => {
  const raw = await redis.hget(getRoomParticipantsKey(roomId), socketId);
  return parseParticipant(raw);
};

export const setParticipant = async (roomId: string, participant: Participant): Promise<void> => {
  const key = getRoomParticipantsKey(roomId);

  await redis.hset(key, {
    [participant.socketId]: JSON.stringify(participant),
  });

  await redis.expire(key, config.ROOM_TTL_SECONDS);
};

export const removeParticipant = async (roomId: string, socketId: string): Promise<void> => {
  await redis.hdel(getRoomParticipantsKey(roomId), socketId);
};

export const listParticipants = async (roomId: string): Promise<Participant[]> => {
  const raw = await redis.hgetall(getRoomParticipantsKey(roomId));

  return Object.values(raw)
    .map((value) => parseParticipant(value))
    .filter((value): value is Participant => value !== null);
};

