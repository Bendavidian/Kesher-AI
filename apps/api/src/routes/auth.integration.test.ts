import { DEMO_PASSWORD, DEMO_PERSONAS, PublicUser } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session';
import { collection } from '../db/collections';
import { runSeed } from '../seed/seed';
import { signIn, startApi, type TestApi } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const now = new Date('2026-09-28T12:00:00Z');
const [A, B] = DEMO_PERSONAS;

describe('sign in, on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi;

  const login = (body: unknown) =>
    fetch(`${api.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const me = (cookie?: string) =>
    fetch(`${api.url}/me`, cookie ? { headers: { cookie } } : undefined);

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_auth_test');
    await runSeed(mongo.db, now);
    api = await startApi(mongo.db);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await api?.close();
    await mongo?.stop();
  });

  it('signs a persona in with the demo password and sets an httpOnly session cookie', async () => {
    const response = await login({ email: A.email, password: DEMO_PASSWORD });

    expect(response.status).toBe(200);
    const user = PublicUser.parse(await response.json());
    expect(user).toMatchObject({ email: A.email, displayName: 'Persona A, AI investor' });
    expect(user.holdings.map((h) => h.symbol)).toEqual(['NVDA', 'MSFT', 'AMZN']);

    const [setCookie] = response.headers.getSetCookie();
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
  });

  it('never sends the password hash', async () => {
    const response = await login({ email: A.email, password: DEMO_PASSWORD });
    const text = await response.text();
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('scrypt$');
  });

  it('answers a wrong password and an unknown email the same way, with no cookie', async () => {
    const wrong = await login({ email: A.email, password: 'not-the-password' });
    const unknown = await login({ email: 'nobody@kesher.example', password: DEMO_PASSWORD });

    for (const response of [wrong, unknown]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'email or password is wrong' });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it('answers 400 for a malformed body, including one that names a user id', async () => {
    const userId = (await collection(mongo.db, 'users').findOne({ email: B.email }))!._id;
    expect((await login('{not json')).status).toBe(400);
    expect((await login({ email: A.email })).status).toBe(400);
    expect((await login({ email: A.email, password: DEMO_PASSWORD, userId })).status).toBe(400);
  });

  it('GET /me gives the signed in user from the cookie, and 401 without one', async () => {
    const cookie = await signIn(api.url, 'B');

    const response = await me(cookie);
    expect(response.status).toBe(200);
    expect(PublicUser.parse(await response.json())).toMatchObject({ email: B.email });

    expect((await me()).status).toBe(401);
    expect((await me(`${SESSION_COOKIE}=forged.token.value`)).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const response = await fetch(`${api.url}/auth/logout`, { method: 'POST' });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`, 'i'),
    );
  });
});
