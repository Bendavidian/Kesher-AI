import { describe, expect, it } from 'vitest';
import { redactor } from './redact';

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
});
