// src/middleware/rateLimiter.ts
import { redis } from '../config';

const consumeToken = async (key: string, ttlSeconds: number, maxRequests: number): Promise<boolean> => {
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, ttlSeconds);
  }

  return count <= maxRequests;
};

export const rateLimitChat = async (socketId: string): Promise<boolean> => {
  return consumeToken(`ratelimit:${socketId}:chat`, 3, 5);
};

export const rateLimitJoinRoom = async (socketId: string): Promise<boolean> => {
  return consumeToken(`ratelimit:${socketId}:join-room`, 60, 3);
};

