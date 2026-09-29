import { describe, expect, it } from 'vitest';
import { Env } from './env';

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
});
