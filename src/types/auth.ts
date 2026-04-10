// src/types/auth.ts
export type UserRole = 'teacher' | 'student';

export interface JwtUserPayload {
  userId: string;
  name: string;
  role: UserRole;
  iat?: number;
  exp?: number;
  iat2?: number;
}

