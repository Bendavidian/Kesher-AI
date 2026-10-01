import { ZodError } from 'zod';

// Driver errors can echo the connection string; never print it, its password or another secret.
export function redactor(
  mongodbUri: string,
  otherSecrets: string[] = [],
): (text: string) => string {
  const secrets = [mongodbUri, ...otherSecrets.filter(Boolean)];
  try {
    const password = new URL(mongodbUri).password;
    if (password) secrets.push(password, decodeURIComponent(password));
  } catch {
    // Not a parseable URL; the full value is still redacted.
  }
  return (text) => secrets.reduce((out, secret) => out.split(secret).join('[REDACTED]'), text);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

// One log line for a failure that repeats on a timer, where a stack trace each time would flood
// the log: the error's name and first message line, or for a schema error its first issue.
export function describeErrorLine(error: unknown): string {
  if (error instanceof ZodError) {
    const [issue] = error.issues;
    return issue ? `ZodError: ${issue.path.join('.') || '(root)'}: ${issue.message}` : 'ZodError';
  }
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.split('\n')[0]!;
}
