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
