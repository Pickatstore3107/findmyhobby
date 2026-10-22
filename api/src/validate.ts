import { z } from 'zod';
import { AppError } from './booking.ts';

/** Validates input against a schema; anything unexpected becomes a clean 400 instead of reaching the database. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError('INVALID_INPUT');
  return r.data;
}
