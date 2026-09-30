import { z } from 'zod';
import { User } from './domain/user';

// The shortest HS256 secret the api accepts, for sessions (JWT_SECRET) and run tokens
// (MCP_TOKEN_SECRET) alike.
export const MIN_SECRET_LENGTH = 32;

// POST /auth/login (docs/INTERFACES.md, REST). The email is compared lowercase, like the stored one.
export const LoginRequest = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// The user as the web sees it, from POST /auth/login and GET /me. The password hash never leaves
// the api, and nothing here identifies the caller to the server: that is the session cookie.
// A guest carries expiresAt, which the web shows; investigatedOn stays on the server.
export const PublicUser = User.omit({ passwordHash: true, createdAt: true, investigatedOn: true });
export type PublicUser = z.infer<typeof PublicUser>;
