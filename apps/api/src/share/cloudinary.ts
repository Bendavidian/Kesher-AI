import { createHash } from 'node:crypto';
import { z } from 'zod';

// Cloudinary on the free plan holds the shared report images (SPEC.md decision log, T30). One
// signed upload request over fetch, no SDK: the api never reads, lists or deletes there.

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

// CLOUDINARY_URL as the Cloudinary console gives it: cloudinary://<api key>:<api secret>@<cloud>.
// Errors never include the value.
export function parseCloudinaryUrl(value: string): CloudinaryConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CLOUDINARY_URL is not a cloudinary:// URL');
  }
  const config = {
    cloudName: url.hostname,
    apiKey: decodeURIComponent(url.username),
    apiSecret: decodeURIComponent(url.password),
  };
  if (url.protocol !== 'cloudinary:' || !config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error('CLOUDINARY_URL must be cloudinary://<api key>:<api secret>@<cloud name>');
  }
  return config;
}

// Cloudinary's request signature: the signed parameters sorted by name as name=value joined
// with &, then the API secret, hashed with SHA-1.
export function signParams(params: Record<string, string>, apiSecret: string): string {
  const joined = Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join('&');
  return createHash('sha1')
    .update(joined + apiSecret)
    .digest('hex');
}

export interface UploadedImage {
  url: string;
  publicId: string;
}

// Uploads one PNG under the given public id and answers its https URL. Without overwrite, a
// second upload of the same id answers the image already stored.
export type Uploader = (png: Buffer, publicId: string) => Promise<UploadedImage>;

// Says what failed with the status only; Cloudinary's answer is not passed on.
export class CloudinaryError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'Cloudinary upload failed' : `Cloudinary answered ${status}`);
    this.name = 'CloudinaryError';
  }
}

const UploadAnswer = z.object({
  // Only Cloudinary's own delivery host is stored and handed out.
  secure_url: z.url({ protocol: /^https$/, hostname: /^res\.cloudinary\.com$/ }),
  public_id: z.string().min(1),
});

const UPLOAD_TIMEOUT_MS = 20_000;

export function cloudinaryUploader(
  config: CloudinaryConfig,
  {
    fetch = globalThis.fetch,
    now = Date.now,
  }: { fetch?: typeof globalThis.fetch; now?: () => number } = {},
): Uploader {
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`;
  return async (png, publicId) => {
    const signed = {
      overwrite: 'false',
      public_id: publicId,
      timestamp: String(Math.floor(now() / 1000)),
    };
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'card.png');
    for (const [name, value] of Object.entries(signed)) form.set(name, value);
    form.set('api_key', config.apiKey);
    form.set('signature', signParams(signed, config.apiSecret));

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new CloudinaryError(null);
    }
    if (!response.ok) throw new CloudinaryError(response.status);
    const answer = UploadAnswer.safeParse(await response.json().catch(() => null));
    if (!answer.success) throw new CloudinaryError(response.status);
    return { url: answer.data.secure_url, publicId: answer.data.public_id };
  };
}
