// src/config.ts
import Redis from 'ioredis';
import { z } from 'zod';
import winston from 'winston';

const envSchema = z.object({
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').url('REDIS_URL must be a valid URL'),
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required'),
  MEDIASOUP_LISTEN_IP: z.string().min(1, 'MEDIASOUP_LISTEN_IP is required'),
  MEDIASOUP_ANNOUNCED_IP: z.string().min(1, 'MEDIASOUP_ANNOUNCED_IP is required'),
  TURN_URL: z.string().min(1, 'TURN_URL is required'),
  TURN_USERNAME: z.string().min(1, 'TURN_USERNAME is required'),
  TURN_PASSWORD: z.string().min(1, 'TURN_PASSWORD is required'),
  OUTPUT_DIR: z.string().min(1, 'OUTPUT_DIR is required'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('; ');

  throw new Error(`Environment validation failed: ${message}`);
}

const allowedOrigins = parsedEnv.data.ALLOWED_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (allowedOrigins.length === 0) {
  throw new Error('Environment validation failed: ALLOWED_ORIGINS must contain at least one origin');
}

export const config = {
  JWT_SECRET: parsedEnv.data.JWT_SECRET,
  REDIS_URL: parsedEnv.data.REDIS_URL,
  ALLOWED_ORIGINS: allowedOrigins,
  MEDIASOUP_LISTEN_IP: parsedEnv.data.MEDIASOUP_LISTEN_IP,
  MEDIASOUP_ANNOUNCED_IP: parsedEnv.data.MEDIASOUP_ANNOUNCED_IP,
  TURN_URL: parsedEnv.data.TURN_URL,
  TURN_USERNAME: parsedEnv.data.TURN_USERNAME,
  TURN_PASSWORD: parsedEnv.data.TURN_PASSWORD,
  OUTPUT_DIR: parsedEnv.data.OUTPUT_DIR,
  ROOM_TTL_SECONDS: 24 * 60 * 60,
} as const;

export type AppConfig = typeof config;

export const redis = new Redis(config.REDIS_URL, {
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
});

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'edu-connect-webrtc' },
  transports: [new winston.transports.Console()],
});

