// src/middleware/auth.ts
import type { NextFunction, Request, Response } from 'express';
import type { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import type { JwtUserPayload } from '../types/auth';

const decodeJwt = (token: string): JwtUserPayload => {
  const decoded = jwt.verify(token, config.JWT_SECRET);

  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Invalid token payload');
  }

  const payload = decoded as Partial<JwtUserPayload>;

  if (!payload.userId || !payload.name || !payload.role) {
    throw new Error('Token payload missing required fields');
  }

  if (payload.role !== 'teacher' && payload.role !== 'student') {
    throw new Error('Token role must be teacher or student');
  }

  return {
    userId: payload.userId,
    name: payload.name,
    role: payload.role,
    iat: payload.iat,
    exp: payload.exp,
  };
};

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing bearer token' });
    return;
  }

  try {
    req.user = decodeJwt(token);
    next();
  } catch (_error: unknown) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }
};

interface SocketWithUserData extends Socket {
  data: Socket['data'] & { user?: JwtUserPayload };
}

export const socketAuthMiddleware = (
  socket: SocketWithUserData,
  next: (error?: Error) => void,
): void => {
  const token = socket.handshake.auth?.token;

  if (!token || typeof token !== 'string') {
    next(new Error('Unauthorized'));
    return;
  }

  try {
    socket.data.user = decodeJwt(token);
    next();
  } catch (_error: unknown) {
    next(new Error('Unauthorized'));
  }
};

