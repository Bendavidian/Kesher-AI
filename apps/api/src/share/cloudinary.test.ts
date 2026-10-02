import { describe, expect, it } from 'vitest';
import { CloudinaryError, cloudinaryUploader, parseCloudinaryUrl, signParams } from './cloudinary';

const config = { cloudName: 'demo-cloud', apiKey: '123456789', apiSecret: 'shh-secret' };

describe('parseCloudinaryUrl', () => {
  it('reads the key, the secret and the cloud name', () => {
    expect(parseCloudinaryUrl('cloudinary://123456789:shh-secret@demo-cloud')).toEqual(config);
  });

  it('refuses anything else without repeating the value', () => {
    for (const value of [
      'not a url',
      'https://123456789:shh-secret@demo-cloud',
      'cloudinary://123456789@demo-cloud',
      'cloudinary://:shh-secret@demo-cloud',
    ]) {
      expect(() => parseCloudinaryUrl(value)).toThrow(/CLOUDINARY_URL/);
      try {
        parseCloudinaryUrl(value);
      } catch (error) {
        expect((error as Error).message).not.toContain('shh-secret');
      }
    }
  });
});

describe('signParams', () => {
  it('matches the example in the Cloudinary documentation', () => {
    expect(
      signParams(
        {
          timestamp: '1315060510',
          public_id: 'sample_image',
          eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
        },
        'abcd',
      ),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});

describe('cloudinaryUploader', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const now = () => Date.parse('2026-10-02T10:00:00Z');

  it('sends one signed upload without overwrite and answers the https URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        Response.json({
          secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/kesher/reports/r1.png',
          public_id: 'kesher/reports/r1',
        }),
      );
    }) as typeof globalThis.fetch;

    const uploaded = await cloudinaryUploader(config, { fetch, now })(png, 'kesher/reports/r1');

    expect(uploaded).toEqual({
      url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/kesher/reports/r1.png',
      publicId: 'kesher/reports/r1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    const form = calls[0]!.init.body as FormData;
    const timestamp = String(now() / 1000);
    expect(form.get('public_id')).toBe('kesher/reports/r1');
    expect(form.get('overwrite')).toBe('false');
    expect(form.get('timestamp')).toBe(timestamp);
    expect(form.get('api_key')).toBe('123456789');
    expect(form.get('signature')).toBe(
      signParams({ overwrite: 'false', public_id: 'kesher/reports/r1', timestamp }, 'shh-secret'),
    );
    // The secret is only ever hashed.
    expect([...form.values()].some((value) => value === 'shh-secret')).toBe(false);
    const file = form.get('file') as Blob;
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
  });

  it('fails with the status only, for an error, a bad answer and no answer', async () => {
    const answering = (response: Response) =>
      cloudinaryUploader(config, { fetch: () => Promise.resolve(response), now });
    await expect(
      answering(
        Response.json({ error: { message: 'Invalid Signature shh-secret' } }, { status: 401 }),
      )(png, 'x'),
    ).rejects.toThrow(new CloudinaryError(401));
    await expect(
      answering(Response.json({ secure_url: 'http://res.cloudinary.com/x.png', public_id: 'x' }))(
        png,
        'x',
      ),
    ).rejects.toThrow(new CloudinaryError(200));
    await expect(
      answering(Response.json({ secure_url: 'https://elsewhere.example/x.png', public_id: 'x' }))(
        png,
        'x',
      ),
    ).rejects.toThrow(new CloudinaryError(200));
    const offline = cloudinaryUploader(config, {
      fetch: () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.cloudinary.com')),
      now,
    });
    await expect(offline(png, 'x')).rejects.toThrow(new CloudinaryError(null));
  });
});
