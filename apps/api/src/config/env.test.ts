import { describe, expect, it } from 'vitest';
import { parseLiveEnv } from './env';

const keys = {
  ALPACA_API_KEY_ID: 'key-id',
  ALPACA_API_SECRET_KEY: 'secret-key',
  SEC_USER_AGENT: 'Kesher test test@example.com',
};

describe('parseLiveEnv', () => {
  it('is off when LIVE_INGEST is unset or false, and needs no keys then', () => {
    expect(parseLiveEnv({})).toEqual({ enabled: false });
    expect(parseLiveEnv({ LIVE_INGEST: 'false' })).toEqual({ enabled: false });
  });

  it('turns on with the Alpaca keys and the SEC User-Agent', () => {
    expect(parseLiveEnv({ LIVE_INGEST: 'true', ...keys })).toEqual({
      enabled: true,
      alpaca: { keyId: 'key-id', secretKey: 'secret-key' },
      secUserAgent: 'Kesher test test@example.com',
    });
  });

  it('fails when on without a key, naming the keys and never a value', () => {
    const run = () =>
      parseLiveEnv({ LIVE_INGEST: 'true', ALPACA_API_KEY_ID: 'key-id', SEC_USER_AGENT: ' ' });
    expect(run).toThrow(
      'Missing or invalid environment variables: ALPACA_API_SECRET_KEY, SEC_USER_AGENT',
    );
    expect(run).not.toThrow(/key-id/);
  });

  it('rejects a value that is not a boolean', () => {
    expect(() => parseLiveEnv({ LIVE_INGEST: 'maybe' })).toThrow(/LIVE_INGEST/);
  });
});
