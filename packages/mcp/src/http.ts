import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { createKesherServer } from './server';
import { RunTokenClaims, RunTokenError, verifyRunToken } from './token';
import type { ToolDeps } from './tools';

export interface McpHttpOptions {
  // MCP_TOKEN_SECRET, the key the api signs run tokens with.
  secret: string;
  deps: ToolDeps;
  onError?: (error: Error) => void;
}

// Serves one HTTP request. parsedBody is the JSON body when a framework has already read it.
export type McpFetch = (request: Request, parsedBody?: unknown) => Promise<Response>;

const BEARER = /^Bearer\s+(\S+)$/i;

function unauthorized(): Response {
  // The body never echoes the token or says why it failed.
  return Response.json(
    { error: 'invalid_token' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } },
  );
}

// Stateless MCP over HTTP. Every request needs a valid run token, and each request gets a fresh
// server that exposes only the tools that token lists.
export function createMcpFetch({ secret, deps, onError }: McpHttpOptions): McpFetch {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      // Set below, only after verification. Parsed again so the server never trusts a shape.
      const claims = RunTokenClaims.parse(authInfo?.extra?.claims);
      return createKesherServer(deps, claims);
    },
    onError ? { onerror: onError } : undefined,
  );

  return async (request, parsedBody) => {
    const token = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return unauthorized();
    let claims: RunTokenClaims;
    try {
      claims = await verifyRunToken(secret, token);
    } catch (error) {
      if (error instanceof RunTokenError) return unauthorized();
      throw error;
    }
    const authInfo: AuthInfo = {
      // Nothing past this point needs the raw token, so it never reaches the SDK or its logs.
      token: '[verified run token]',
      clientId: claims.sub,
      scopes: claims.tools,
      expiresAt: claims.exp,
      extra: { claims },
    };
    return handler.fetch(
      request,
      parsedBody === undefined ? { authInfo } : { authInfo, parsedBody },
    );
  };
}
