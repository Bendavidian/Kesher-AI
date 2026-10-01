import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeErrorLine, redactor } from './redact';

describe('redactor', () => {
  it('removes the connection string and its password, raw and decoded', () => {
    const uri = 'mongodb+srv://kesher:p%40ss-word@cluster0.example.net/kesher';
    const redact = redactor(uri);
    expect(redact(`failed ${uri}`)).toBe('failed [REDACTED]');
    expect(redact('auth p%40ss-word and p@ss-word')).toBe('auth [REDACTED] and [REDACTED]');
  });

  it('still removes a value that is not a parseable URL', () => {
    expect(redactor('mongodb://%zz')('x mongodb://%zz y')).toBe('x [REDACTED] y');
  });

  it('also removes the other secrets it is given', () => {
    const secret = 'mcp-token-secret-that-is-long-enough';
    const redact = redactor('mongodb://localhost/kesher', [secret]);
    expect(redact(`key ${secret} here`)).toBe('key [REDACTED] here');
  });
});

describe('describeErrorLine', () => {
  it('keeps one line: the name and the first line of the message, never the stack', () => {
    expect(describeErrorLine(new TypeError('fetch failed\nmore'))).toBe('TypeError: fetch failed');
    expect(describeErrorLine('plain\ntext')).toBe('plain');
  });

  it('names the first issue of a schema error', () => {
    const error = z.object({ news: z.array(z.object({ id: z.int() })) }).safeParse({
      news: [{ id: 'x' }],
    }).error;
    expect(describeErrorLine(error)).toMatch(/^ZodError: news\.0\.id: /);
  });
});
