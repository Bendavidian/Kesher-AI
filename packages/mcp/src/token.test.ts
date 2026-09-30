import { randomUUID } from 'node:crypto';
import { SignJWT, UnsecuredJWT, decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOLS,
  RUN_TOKEN_TTL_SECONDS,
  RunTokenError,
  authorize,
  mintRunToken,
  verifyRunToken,
} from './token';

const SECRET = 'test-secret-that-is-at-least-32-chars';
const userId = randomUUID();
const at = new Date('2026-09-28T12:00:00Z');
const later = (seconds: number) => new Date(at.getTime() + seconds * 1000);

// Signs arbitrary claims with the right key, to prove the claims themselves are validated.
async function signRaw(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
  const iat = Math.floor(at.getTime() / 1000);
  return new SignJWT({ iat, exp: iat + RUN_TOKEN_TTL_SECONDS, ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
}

describe('run token', () => {
  it('round trips the user, agent and tools with a fixed 5 minute lifetime', async () => {
    const token = await mintRunToken(
      SECRET,
      { userId, agent: 'research', tools: ['get_event', 'search_news'] },
      at,
    );
    const claims = await verifyRunToken(SECRET, token, later(60));
    expect(claims).toMatchObject({
      sub: userId,
      agent: 'research',
      tools: ['get_event', 'search_news'],
    });
    expect(claims.exp - claims.iat).toBe(RUN_TOKEN_TTL_SECONDS);
    expect(RUN_TOKEN_TTL_SECONDS).toBe(300);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await mintRunToken(
      'another-secret-that-is-at-least-32-chars',
      { userId, agent: 'research', tools: ['get_event'] },
      at,
    );
    await expect(verifyRunToken(SECRET, token, at)).rejects.toBeInstanceOf(RunTokenError);
  });

  it('rejects an expired token', async () => {
    const token = await mintRunToken(
      SECRET,
      { userId, agent: 'research', tools: ['get_event'] },
      at,
    );
    await expect(verifyRunToken(SECRET, token, later(RUN_TOKEN_TTL_SECONDS + 1))).rejects.toThrow(
      RunTokenError,
    );
  });

  it('rejects an unsigned token', async () => {
    const token = new UnsecuredJWT({ sub: userId, agent: 'research', tools: ['get_event'] })
      .setIssuedAt(Math.floor(at.getTime() / 1000))
      .setExpirationTime(Math.floor(at.getTime() / 1000) + 300)
      .encode();
    await expect(verifyRunToken(SECRET, token, at)).rejects.toThrow(RunTokenError);
  });

  it('rejects claims outside the contract, even when signed correctly', async () => {
    const cases = [
      { sub: userId, agent: 'research', tools: ['drop_database'] },
      { sub: userId, agent: 'admin', tools: ['get_event'] },
      { sub: userId, agent: 'research', tools: [] },
      { agent: 'research', tools: ['get_event'] },
      { sub: 'not-a-uuid', agent: 'research', tools: ['get_event'] },
      { sub: userId, agent: 'research' },
      { sub: userId, agent: 'research', tools: ['get_event'], userId },
    ];
    for (const payload of cases) {
      await expect(verifyRunToken(SECRET, await signRaw(payload), at)).rejects.toThrow(
        RunTokenError,
      );
    }
  });

  it('rejects a lifetime longer than 5 minutes', async () => {
    const iat = Math.floor(at.getTime() / 1000);
    const token = await signRaw({
      sub: userId,
      agent: 'research',
      tools: ['get_event'],
      exp: iat + 3600,
    });
    await expect(verifyRunToken(SECRET, token, at)).rejects.toThrow(RunTokenError);
  });

  it('never puts the token in the error message', async () => {
    const token = await mintRunToken(
      SECRET,
      { userId, agent: 'research', tools: ['get_event'] },
      at,
    );
    const error = await verifyRunToken('x'.repeat(40), token, at).catch((e: unknown) => e);
    expect(String(error)).not.toContain(token);
    expect((error as Error).message).not.toContain(token.split('.')[2]);
  });

  it('refuses to mint or verify with a short secret', async () => {
    await expect(
      mintRunToken('short', { userId, agent: 'research', tools: ['get_event'] }, at),
    ).rejects.toThrow();
    await expect(verifyRunToken('short', 'a.b.c', at)).rejects.toThrow(RunTokenError);
  });

  it('mints each tool once', async () => {
    const token = await mintRunToken(
      SECRET,
      { userId, agent: 'research', tools: ['get_event', 'get_event'] },
      at,
    );
    expect(decodeJwt(token).tools).toEqual(['get_event']);
  });
});

describe('agent tool sets', () => {
  it('gives the research agent every MVP tool and the verifier none', () => {
    expect([...AGENT_TOOLS.research].sort()).toEqual([
      'get_company_relationships',
      'get_event',
      'get_financial_facts',
      'get_my_portfolio',
      'get_price_reaction',
      'search_filings',
      'search_news',
    ]);
    expect(AGENT_TOOLS.verifier).toEqual([]);
  });

  it('never mints a token for the verifier, which has no tools', async () => {
    await expect(
      mintRunToken(SECRET, { userId, agent: 'verifier', tools: ['get_event'] }, at),
    ).rejects.toThrow(/agent's set/);
  });

  it("rejects a signed token that lists a tool outside its agent's set", async () => {
    const token = await signRaw({ sub: userId, agent: 'verifier', tools: ['get_event'] });
    await expect(verifyRunToken(SECRET, token, at)).rejects.toThrow(RunTokenError);
  });
});

describe('authorize', () => {
  it('allows exactly the tools the token lists', async () => {
    const token = await mintRunToken(
      SECRET,
      { userId, agent: 'research', tools: ['get_event'] },
      at,
    );
    const claims = await verifyRunToken(SECRET, token, at);
    expect(authorize(claims, 'get_event')).toBe(true);
    expect(authorize(claims, 'search_news')).toBe(false);
  });
});
