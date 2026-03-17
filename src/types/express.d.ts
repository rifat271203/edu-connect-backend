// src/types/express.d.ts
import type { JwtUserPayload } from './auth';

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

export {};

