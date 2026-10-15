import { z } from 'zod';
import { encryptedBackupEnvelopeSchema } from '$lib/persistence/schemas';

/** Shared contract between the owner-only sync API and the browser client. */

export const SYNC_API_PATH = '/api/sync';
export const SESSION_API_PATH = '/api/auth/session';
export const LOGIN_API_PATH = '/api/auth/login';
export const LOGOUT_API_PATH = '/api/auth/logout';

export const MAX_SYNC_BODY_BYTES = 5_000_000;

const revisionSchema = z.number().int().min(0);

export const remoteStateSchema = z.strictObject({
  revision: revisionSchema,
  updatedAt: z.string().nullable(),
  envelope: encryptedBackupEnvelopeSchema.nullable()
});

export const pushRequestSchema = z.strictObject({
  baseRevision: revisionSchema,
  envelope: encryptedBackupEnvelopeSchema
});

export const pushResultSchema = z.strictObject({
  revision: revisionSchema,
  updatedAt: z.string()
});

export const conflictResultSchema = z.strictObject({
  revision: revisionSchema
});

export const sessionResultSchema = z.strictObject({
  authenticated: z.boolean(),
  login: z.string().nullable()
});

export type RemoteState = z.infer<typeof remoteStateSchema>;
export type PushRequest = z.infer<typeof pushRequestSchema>;
export type PushResult = z.infer<typeof pushResultSchema>;
export type SessionResult = z.infer<typeof sessionResultSchema>;
