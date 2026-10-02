// The body parser's client errors (express.json): a body that is not JSON, one over the route's
// limit, and any other body it could not read (an unsupported encoding or charset, an aborted
// request), each with the parser's own 4xx status. Any other error is the server's. app.ts
// answers them in the REST shape and POST /mcp in JSON-RPC (SPEC.md decision log, T30).
export interface BodyError {
  kind: 'invalid_json' | 'too_large' | 'unreadable';
  status: number;
}

export function bodyError(error: unknown): BodyError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { type, status } = error as { type?: unknown; status?: unknown };
  if (type === 'entity.parse.failed') return { kind: 'invalid_json', status: 400 };
  if (type === 'entity.too.large') return { kind: 'too_large', status: 413 };
  // body-parser marks its errors with a string type; a 4xx from it is the client's.
  if (typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500) {
    return { kind: 'unreadable', status };
  }
  return null;
}
