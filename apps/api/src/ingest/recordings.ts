import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  AccessionNumber,
  AlpacaNewsId,
  AlpacaNewsItem,
  EdgarFiling,
  LiveRecording,
} from '@kesher/shared';
import { MongoServerError, type Db } from 'mongodb';
import { z } from 'zod';
import { collection } from '../db/collections';

export { AlpacaNewsId };

const DUPLICATE_KEY = 11000;

// Committed recordings at the repo root, from apps/api/src/ingest: recordings/<provider>/<id>.json.
// Replay reads them by id, so the demo and the evals never depend on a provider being up.
export const RECORDINGS_DIR = resolve(import.meta.dirname, '../../../../recordings');

// The raw provider item, without the full article content.
export const Recording = z.strictObject({
  provider: z.literal('alpaca'),
  recordedAt: z.iso.datetime(),
  item: AlpacaNewsItem,
});
export type Recording = z.infer<typeof Recording>;

// A filing recording: the submissions row the poller read. EDGAR filings have no body here; their
// text lives in FilingChunk (SPEC.md Domain model).
export const FilingRecording = z.strictObject({
  provider: z.literal('sec_edgar'),
  recordedAt: z.iso.datetime(),
  item: EdgarFiling,
});
export type FilingRecording = z.infer<typeof FilingRecording>;

// A live item as the provider sent it, before toIncomingItem or toIncomingFiling maps it.
export type LiveItem =
  { provider: 'alpaca'; item: AlpacaNewsItem } | { provider: 'sec_edgar'; item: EdgarFiling };

export const externalIdOf = (live: LiveItem): string =>
  live.provider === 'alpaca' ? String(live.item.id) : live.item.accessionNumber;

export function recordingPath(externalId: string, dir = RECORDINGS_DIR): string {
  return join(dir, 'alpaca', `${AlpacaNewsId.parse(externalId)}.json`);
}

export function filingRecordingPath(accession: string, dir = RECORDINGS_DIR): string {
  return join(dir, 'sec_edgar', `${AccessionNumber.parse(accession)}.json`);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// null when no recording exists for the id. A file that fails its schema, or holds another
// id, throws.
export async function loadRecording(
  externalId: string,
  dir = RECORDINGS_DIR,
): Promise<Recording | null> {
  const contents = await readJson(recordingPath(externalId, dir));
  if (contents === null) return null;
  const recording = Recording.parse(contents);
  if (String(recording.item.id) !== externalId) {
    throw new Error(`recording ${externalId} holds item ${recording.item.id}`);
  }
  return recording;
}

export async function loadFilingRecording(
  accession: string,
  dir = RECORDINGS_DIR,
): Promise<FilingRecording | null> {
  const contents = await readJson(filingRecordingPath(accession, dir));
  if (contents === null) return null;
  const recording = FilingRecording.parse(contents);
  if (recording.item.accessionNumber !== accession) {
    throw new Error(`recording ${accession} holds filing ${recording.item.accessionNumber}`);
  }
  return recording;
}

// Keeps a live item that passed the pre filter, for replay. The item is parsed first, so the
// article body and anything else the schema does not name never reach the database. The first
// recording of an id wins; true when this call wrote it.
export async function recordLive(db: Db, live: LiveItem, now = new Date()): Promise<boolean> {
  const { _id, provider, externalId, ...insertFields } = LiveRecording.parse({
    _id: randomUUID(),
    provider: live.provider,
    externalId: externalIdOf(live),
    recordedAt: now,
    item: live.item,
  });
  try {
    const result = await collection(db, 'recordings').updateOne(
      { provider, externalId },
      { $setOnInsert: { _id, ...insertFields } },
      { upsert: true },
    );
    return result.upsertedCount === 1;
  } catch (error) {
    // Two first upserts of one key: the other one recorded it.
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return false;
    throw error;
  }
}

// The recording of one item by provider and id: the committed file first, then the live
// recordings collection. null when neither holds it.
export async function findRecording(
  db: Db,
  provider: LiveItem['provider'],
  externalId: string,
  dir = RECORDINGS_DIR,
): Promise<LiveItem | null> {
  if (provider === 'alpaca') {
    const file = await loadRecording(externalId, dir);
    if (file) return { provider, item: file.item };
  } else {
    const file = await loadFilingRecording(externalId, dir);
    if (file) return { provider, item: file.item };
  }
  const stored = await collection(db, 'recordings').findOne({ provider, externalId });
  if (!stored) return null;
  const recording = LiveRecording.parse(stored);
  return recording.provider === 'alpaca'
    ? { provider: 'alpaca', item: recording.item }
    : { provider: 'sec_edgar', item: recording.item };
}

export type ExportResult =
  | { outcome: 'written'; path: string }
  | { outcome: 'exists'; path: string }
  | { outcome: 'missing' };

// Writes a live recording from the collection to recordings/<provider>/<id>.json, in the format
// of the committed recordings, for an item picked for the demo or the evals. An existing file is
// kept unless force is set.
export async function exportRecording(
  db: Db,
  provider: LiveItem['provider'],
  externalId: string,
  { dir = RECORDINGS_DIR, force = false }: { dir?: string; force?: boolean } = {},
): Promise<ExportResult> {
  const path =
    provider === 'alpaca' ? recordingPath(externalId, dir) : filingRecordingPath(externalId, dir);
  if (!force && (await readJson(path)) !== null) return { outcome: 'exists', path };
  const stored = await collection(db, 'recordings').findOne({ provider, externalId });
  if (!stored) return { outcome: 'missing' };
  const { recordedAt, item } = LiveRecording.parse(stored);
  const file = { provider, recordedAt: recordedAt.toISOString(), item };
  // Validated as replay will read it, so a written file always loads.
  if (provider === 'alpaca') Recording.parse(file);
  else FilingRecording.parse(file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
  return { outcome: 'written', path };
}
