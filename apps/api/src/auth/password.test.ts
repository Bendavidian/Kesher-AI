import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stable', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(first).not.toBe(second);
  });

  it('stores the scrypt parameters with the hash', async () => {
    expect(await hashPassword('secret')).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    for (const stored of ['', 'plain', 'scrypt$16384$8$1$salt', 'bcrypt$1$2$3$a$b']) {
      expect(await verifyPassword('secret', stored)).toBe(false);
    }
  });
});
