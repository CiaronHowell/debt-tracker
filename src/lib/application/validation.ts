import { z } from 'zod';
import { AppError } from './errors';

export function validateInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new AppError(
    'VALIDATION_FAILED',
    'Some entered information is invalid. Review the highlighted fields.',
    {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message
      }))
    }
  );
}
