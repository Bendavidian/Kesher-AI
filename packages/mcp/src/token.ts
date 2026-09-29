import { AgentName, Id, MIN_SECRET_LENGTH, TOOL_NAMES, ToolName } from '@kesher/shared';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

// The tool names live in packages/shared, so the web can name a token's scope.
export { TOOL_NAMES, ToolName };

// Fixed by the contract; callers cannot choose a longer lifetime.
export const RUN_TOKEN_TTL_SECONDS = 300;
export { MIN_SECRET_LENGTH };

// The only source of identity and permissions on the server (principle 5).
export const RunTokenClaims = z
  .strictObject({
    sub: Id,
    agent: AgentName,
    tools: z.array(ToolName).min(1),
    iat: z.int(),
    exp: z.int(),
  })
  .refine((claims) => claims.exp - claims.iat === RUN_TOKEN_TTL_SECONDS, {
    error: 'a run token lives exactly 5 minutes',
  });
export type RunTokenClaims = z.infer<typeof RunTokenClaims>;

const MintInput = z.strictObject({
  userId: Id,
  agent: AgentName,
  tools: z.array(ToolName).min(1),
});
export type MintInput = z.infer<typeof MintInput>;

// One message for every failure, so a caller learns nothing about why and the token is never echoed.
export class RunTokenError extends Error {
  constructor() {
    super('invalid run token');
    this.name = 'RunTokenError';
  }
}

function keyOf(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`MCP_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

// Minted by the api for one agent run.
export async function mintRunToken(
  secret: string,
  input: MintInput,
  now: Date = new Date(),
): Promise<string> {
  const { userId, agent, tools } = MintInput.parse(input);
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ agent, tools: [...new Set(tools)] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + RUN_TOKEN_TTL_SECONDS)
    .sign(keyOf(secret));
}

// HS256 only: unsigned tokens and other algorithms fail before the claims are read.
export async function verifyRunToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<RunTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: ['HS256'],
      currentDate: now,
    });
    return RunTokenClaims.parse(payload);
  } catch {
    throw new RunTokenError();
  }
}

export function authorize(claims: RunTokenClaims, tool: ToolName): boolean {
  return claims.tools.includes(tool);
}
