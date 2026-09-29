import { describe, expect, it } from 'vitest';
import { LoginRequest, PublicUser } from './auth';

describe('LoginRequest', () => {
  it('lowercases and trims the email', () => {
    expect(LoginRequest.parse({ email: ' Persona.A@Kesher.Example ', password: 'x' })).toEqual({
      email: 'persona.a@kesher.example',
      password: 'x',
    });
  });

  it('rejects a missing password, a bad email and unknown keys such as a user id', () => {
    expect(LoginRequest.safeParse({ email: 'a@b.example', password: '' }).success).toBe(false);
    expect(LoginRequest.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(
      LoginRequest.safeParse({
        email: 'a@b.example',
        password: 'x',
        userId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});

describe('PublicUser', () => {
  const user = {
    _id: '00000000-0000-4000-8000-000000000001',
    email: 'persona.b@kesher.example',
    displayName: 'Persona B, semiconductor investor',
    holdings: [{ symbol: 'TSM', quantity: 80 }],
    interests: ['foundry'],
  };

  it('accepts the public fields', () => {
    expect(PublicUser.parse(user)).toEqual(user);
  });

  it('never carries the password hash', () => {
    expect(PublicUser.safeParse({ ...user, passwordHash: 'scrypt$1' }).success).toBe(false);
  });
});
