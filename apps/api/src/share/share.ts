import type { ShareImage } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { reportDetail } from '../research/report';
import { cardContent, cardSvg } from './card';
import type { Uploader } from './cloudinary';
import { renderPng } from './render';

export type ShareOutcome =
  | { outcome: 'shared'; url: string; created: boolean }
  | { outcome: 'not_found' }
  // A new image is needed and CLOUDINARY_URL is not set.
  | { outcome: 'not_configured' };

export interface ShareDeps {
  db: Db;
  // Unset without CLOUDINARY_URL: a report already shared still answers its image.
  upload?: Uploader;
  render?: (svg: string) => Buffer;
  now?: () => Date;
}

export const sharePublicId = (reportId: string) => `kesher/reports/${reportId}`;

// The share card of one of the user's reports (SPEC.md decision log, T30). The first share
// renders and uploads the card and stores Report.shareImage; every later share answers it with
// no upload. Two shares of the same report at once upload once. The caller has already refused a
// guest.
export function createSharer({
  db,
  upload,
  render = renderPng,
  now = () => new Date(),
}: ShareDeps) {
  const reports = collection(db, 'reports');
  const pending = new Map<string, Promise<ShareImage>>();

  async function create(reportId: string, svg: string, uploader: Uploader): Promise<ShareImage> {
    const uploaded = await uploader(render(svg), sharePublicId(reportId));
    const image: ShareImage = { url: uploaded.url, publicId: uploaded.publicId, createdAt: now() };
    const set = await reports.updateOne(
      { _id: reportId, shareImage: { $exists: false } },
      { $set: { shareImage: image } },
    );
    if (set.modifiedCount === 1) return image;
    // Stored in between, by another process: that one stands.
    const stored = await reports.findOne({ _id: reportId }, { projection: { shareImage: 1 } });
    return stored?.shareImage ?? image;
  }

  return async function share(userId: string, reportId: string): Promise<ShareOutcome> {
    // Owner only: null for an unknown report and for another user's, alike.
    const detail = await reportDetail(db, userId, reportId);
    if (!detail) return { outcome: 'not_found' };
    if (detail.report.shareImage) {
      return { outcome: 'shared', url: detail.report.shareImage.url, created: false };
    }
    if (!upload) return { outcome: 'not_configured' };

    let running = pending.get(reportId);
    const created = !running;
    if (!running) {
      running = create(reportId, cardSvg(cardContent(detail)), upload).finally(() =>
        pending.delete(reportId),
      );
      pending.set(reportId, running);
    }
    const image = await running;
    return { outcome: 'shared', url: image.url, created };
  };
}

export type Sharer = ReturnType<typeof createSharer>;
