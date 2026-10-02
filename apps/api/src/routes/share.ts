import { Id, isGuest, ShareResponse } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { currentUser, requireUser } from '../auth/session';
import { collection } from '../db/collections';
import { createRateLimiter } from '../guest/rateLimit';
import type { Uploader } from '../share/cloudinary';
import { createSharer } from '../share/share';

const HOUR_MS = 60 * 60 * 1000;
// Share requests per user per hour (SPEC.md decision log, T30). Each report uploads once at most,
// so this bounds the rendering, not the uploads.
export const SHARE_LIMIT = 10;

export interface ShareOptions {
  // Cloudinary (share/cloudinary.ts) when CLOUDINARY_URL is set; a fake in tests.
  upload?: Uploader;
  // The clock of the limiter and of shareImage.createdAt. For tests.
  now?: () => number;
  limit?: number;
  render?: (svg: string) => Buffer;
}

// POST /reports/:reportId/share (docs/INTERFACES.md, REST): the public URL of the report's share
// card. The user comes from the session cookie only; the report must be theirs.
export function shareRouter(
  db: Db,
  secret: string,
  {
    upload,
    now = Date.now,
    limit = SHARE_LIMIT,
    render,
    logError,
  }: ShareOptions & {
    logError: (error: unknown) => void;
  },
): Router {
  const router = Router();
  const limiter = createRateLimiter({ limit, windowMs: HOUR_MS, now });
  const share = createSharer({
    db,
    ...(upload ? { upload } : {}),
    ...(render ? { render } : {}),
    now: () => new Date(now()),
  });

  router.post('/reports/:reportId/share', requireUser(secret), async (req, res) => {
    const reportId = Id.safeParse(req.params.reportId);
    if (!reportId.success) {
      res.status(400).json({ error: 'reportId must be a report id' });
      return;
    }
    const userId = currentUser(res);
    // A public image would outlive a guest, whom T24 deletes after 24 hours.
    const user = await collection(db, 'users').findOne(
      { _id: userId },
      { projection: { expiresAt: 1 } },
    );
    if (!user) {
      res.status(401).json({ error: 'sign in required' });
      return;
    }
    if (isGuest(user)) {
      res.status(403).json({ error: 'sharing is for the personas' });
      return;
    }
    const take = limiter.take(userId);
    if (!take.ok) {
      res.set('Retry-After', String(take.retryAfterSeconds));
      res.status(429).json({ error: 'too many shares; try again later' });
      return;
    }

    let shared;
    try {
      shared = await share(userId, reportId.data);
    } catch (error) {
      // Rendering or the upload failed; the cause goes to the log only.
      logError(error);
      res.status(503).json({ error: 'the share image could not be made; try again later' });
      return;
    }
    if (shared.outcome === 'not_found') {
      res.status(404).json({ error: 'no report with that id' });
      return;
    }
    if (shared.outcome === 'not_configured') {
      res.status(503).json({ error: 'sharing is not configured on this server' });
      return;
    }
    res.status(shared.created ? 201 : 200).json(ShareResponse.parse({ url: shared.url }));
  });

  return router;
}
