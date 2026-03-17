// src/routes/auth.ts
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { config } from '../config';

const bodySchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['teacher', 'student']),
});

const authRouter = Router();

authRouter.post('/token', (req, res) => {
  const parsed = bodySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
    return;
  }

  const { userId, name, role } = parsed.data;

  const token = jwt.sign(
    {
      userId,
      name,
      role,
    },
    config.JWT_SECRET,
    {
      expiresIn: '8h',
    },
  );

  res.json({ token });
});

export { authRouter };
export default authRouter;

