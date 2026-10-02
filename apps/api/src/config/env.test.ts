import { describe, expect, it } from 'vitest';
import { Env, parseCloudinaryEnv, parseLiveEnv } from './env';

const base = { MONGODB_URI: 'mongodb://localhost:27017' };

describe('Env', () => {
  it('turns AUTO_RESEARCH on when it is unset', () => {
    expect(Env.parse(base).AUTO_RESEARCH).toBe(true);
  });

  it('reads AUTO_RESEARCH true and false', () => {
    expect(Env.parse({ ...base, AUTO_RESEARCH: 'true' }).AUTO_RESEARCH).toBe(true);
    expect(Env.parse({ ...base, AUTO_RESEARCH: 'false' }).AUTO_RESEARCH).toBe(false);
  });

  it('rejects any other AUTO_RESEARCH value, so a typo never turns research on or off', () => {
    for (const value of ['no', 'off', '0', 'FALSE', '']) {
      expect(Env.safeParse({ ...base, AUTO_RESEARCH: value }).success).toBe(false);
    }
  });

  it('turns DEMO_MODE on when unset outside production, and off when unset in production', () => {
    expect(Env.parse(base).DEMO_MODE).toBe(true);
    expect(Env.parse({ ...base, NODE_ENV: 'development' }).DEMO_MODE).toBe(true);
    expect(Env.parse({ ...base, NODE_ENV: 'test' }).DEMO_MODE).toBe(true);
    expect(Env.parse({ ...base, NODE_ENV: 'production' }).DEMO_MODE).toBe(false);
  });

  it('reads DEMO_MODE true and false in any NODE_ENV', () => {
    for (const NODE_ENV of ['development', 'production']) {
      expect(Env.parse({ ...base, NODE_ENV, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
      expect(Env.parse({ ...base, NODE_ENV, DEMO_MODE: 'false' }).DEMO_MODE).toBe(false);
    }
  });

  it('turns LOCAL_EMBEDDINGS on when unset, and reads true and false', () => {
    expect(Env.parse(base).LOCAL_EMBEDDINGS).toBe(true);
    expect(Env.parse({ ...base, LOCAL_EMBEDDINGS: 'true' }).LOCAL_EMBEDDINGS).toBe(true);
    expect(Env.parse({ ...base, LOCAL_EMBEDDINGS: 'false' }).LOCAL_EMBEDDINGS).toBe(false);
  });

  it('rejects any other LOCAL_EMBEDDINGS value', () => {
    for (const value of ['no', '0', 'FALSE', '']) {
      expect(Env.safeParse({ ...base, LOCAL_EMBEDDINGS: value }).success).toBe(false);
    }
  });

  it('rejects any other DEMO_MODE value, so a typo never opens the demo route', () => {
    for (const value of ['yes', 'on', '1', 'TRUE', '']) {
      const parsed = Env.safeParse({ ...base, NODE_ENV: 'production', DEMO_MODE: value });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(['DEMO_MODE']);
    }
  });
});

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

describe('parseCloudinaryEnv (T30)', () => {
  it('is optional: unset or empty, sharing is off', () => {
    expect(parseCloudinaryEnv({})).toBeUndefined();
    expect(parseCloudinaryEnv({ CLOUDINARY_URL: '' })).toBeUndefined();
  });

  it('reads the console URL', () => {
    expect(parseCloudinaryEnv({ CLOUDINARY_URL: 'cloudinary://123:s3cret@my-cloud' })).toEqual({
      cloudName: 'my-cloud',
      apiKey: '123',
      apiSecret: 's3cret',
    });
  });

  it('stops the api for a malformed value, naming the key and never the value', () => {
    expect(() => parseCloudinaryEnv({ CLOUDINARY_URL: 'https://123:s3cret@my-cloud' })).toThrow(
      /^CLOUDINARY_URL must be/,
    );
    expect(() => parseCloudinaryEnv({ CLOUDINARY_URL: 'https://123:s3cret@my-cloud' })).not.toThrow(
      /s3cret/,
    );
  });
});
