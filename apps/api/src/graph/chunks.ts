import { randomUUID } from 'node:crypto';
import { FilingChunk, type UniverseSymbol } from '@kesher/shared';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { collection } from '../db/collections';
import { MAX_CHUNK_TOKENS } from './embed';
import type { Section } from './sections';
import { sentences } from './sections';

// FilingChunks for RAG (SPEC.md Interest graph): Item 1 and Item 1A of each 10-K filer, split on
// sentence boundaries into chunks of at most 256 word pieces, each embedded locally. A chunk never
// crosses a heading, and it is embedded as "heading. text" so a short passage keeps its topic
// (SPEC.md decision log, T11); the stored text stays the filing's own. T11 owns the chunks;
// foreign issuers get none in the MVP.

// FilingChunk.text allows at most 2,000 characters.
export const MAX_CHUNK_CHARS = 2_000;

export interface ChunkLimits {
  maxTokens: number;
  maxChars: number;
}

const DEFAULT_LIMITS: ChunkLimits = { maxTokens: MAX_CHUNK_TOKENS, maxChars: MAX_CHUNK_CHARS };

// Packs sentences in order into chunks within both limits. A sentence too long on its own is split
// on word boundaries, and a single word too long on its own is split by characters.
export function chunkSentences(
  list: readonly string[],
  countTokens: (text: string) => number,
  limits: ChunkLimits = DEFAULT_LIMITS,
): string[] {
  const fits = (text: string) =>
    text.length <= limits.maxChars && countTokens(text) <= limits.maxTokens;
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };
  const add = (piece: string) => {
    const joined = current ? `${current} ${piece}` : piece;
    if (fits(joined)) {
      current = joined;
      return true;
    }
    return false;
  };

  for (const sentence of list) {
    if (add(sentence)) continue;
    flush();
    if (add(sentence)) continue;
    for (const word of sentence.split(' ')) {
      if (add(word)) continue;
      flush();
      if (add(word)) continue;
      // A word longer than a whole chunk: cut it by characters.
      let rest = word;
      while (rest) {
        let size = Math.min(rest.length, limits.maxChars);
        while (size > 1 && !fits(rest.slice(0, size))) size = Math.floor(size / 2);
        chunks.push(rest.slice(0, size));
        rest = rest.slice(size);
      }
    }
  }
  flush();
  return chunks;
}

export interface SectionChunk {
  section: Section['name'];
  // The heading the chunk sits under, or null before the first heading of its section.
  heading: string | null;
  // The filing's text, as stored.
  text: string;
  // What the model embeds: the heading and the text. Always within the token limit.
  embedText: string;
}

// A short block that does not read as text is a heading: it ends no sentence or list lead-in,
// does not start with a bullet or a lower case letter, and is not a table row of figures. Page
// numbers, "Table of Contents" and "2025 10-K" running footers are the only blocks dropped.
const ENDS_TEXT = /(?:[.!?:;,]["”’)]*|\b(?:and|or|including))$/;
const STARTS_TEXT = /^[•●▪◦·○■◆➢\-–—*a-z]/;
const FIGURES = /\d.*[%$]|[%$].*\d/;
const MAX_HEADING_CHARS = 120;
const NOISE =
  /^(?:\d{1,3}|Table of Contents|.*\|\s*\d{4}\s+(?:Form\s+)?10-K|.*\b\d{4}\s+10-K\s+\d{1,3})$/i;

export function isHeading(block: string): boolean {
  return (
    block.length < MAX_HEADING_CHARS &&
    !ENDS_TEXT.test(block) &&
    !STARTS_TEXT.test(block) &&
    !FIGURES.test(block)
  );
}

export interface Run {
  // The last heading line before the body, used to label every chunk of the run.
  heading: string | null;
  // Every block of the run, heading lines included, so no filing text is lost.
  blocks: string[];
}

// Splits a section at its headings. A heading starts a new run once the current run has body text;
// consecutive heading lines (a title and its subtitle, a list of names) stay in one run.
export function runs(blocks: readonly string[]): Run[] {
  const out: Run[] = [];
  let current: Run = { heading: null, blocks: [] };
  let hasBody = false;
  for (const block of blocks) {
    if (NOISE.test(block)) continue;
    if (isHeading(block)) {
      if (hasBody) {
        out.push(current);
        current = { heading: null, blocks: [] };
        hasBody = false;
      }
      current.heading = block;
      current.blocks.push(block);
      continue;
    }
    current.blocks.push(block);
    hasBody = true;
  }
  if (current.blocks.length > 0) out.push(current);
  return out;
}

// The heading is embedded with every chunk of its run; the first chunk already starts with it.
const embedInput = (heading: string | null, text: string) =>
  heading === null || text.startsWith(heading) ? text : `${heading}. ${text}`;

// The chunks of a filing, section by section and heading by heading, in document order.
export function chunkSections(
  list: readonly Section[],
  countTokens: (text: string) => number,
  limits: ChunkLimits = DEFAULT_LIMITS,
): SectionChunk[] {
  return list.flatMap((section) =>
    runs(section.blocks).flatMap(({ heading, blocks }) =>
      // The heading counts against the token limit, so the model never truncates a chunk.
      chunkSentences(
        sentences(blocks),
        (text) => countTokens(embedInput(heading, text)),
        limits,
      ).map((text) => ({
        section: section.name,
        heading,
        text,
        embedText: embedInput(heading, text),
      })),
    ),
  );
}

export interface ChunkWrite {
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

// Writes one filing's chunks, keyed by (sourceId, chunkIndex): a rerun with the same text and
// vectors changes nothing, and chunks past the new end are removed. The other filings' chunks are
// never touched.
export async function writeChunks(
  db: Db,
  source: { sourceId: string; symbol: UniverseSymbol },
  chunks: readonly SectionChunk[],
  embeddings: readonly number[][],
  now = new Date(),
): Promise<ChunkWrite> {
  if (chunks.length !== embeddings.length) throw new Error('one embedding per chunk');
  // A filing that yields no chunks is a parsing failure, never a reason to delete its chunks.
  if (chunks.length === 0) throw new Error(`no chunks for Source ${source.sourceId}`);
  const docs = chunks.map((chunk, chunkIndex) =>
    FilingChunk.parse({
      _id: randomUUID(),
      sourceId: source.sourceId,
      symbol: source.symbol,
      form: '10-K',
      section: chunk.section,
      chunkIndex,
      text: chunk.text,
      embedding: embeddings[chunkIndex],
      createdAt: now,
    }),
  );
  const target = collection(db, 'filing_chunks');
  const operations: AnyBulkWriteOperation<FilingChunk>[] = docs.map(
    ({ _id, createdAt, ...fields }) => ({
      updateOne: {
        filter: { sourceId: fields.sourceId, chunkIndex: fields.chunkIndex },
        update: { $set: fields, $setOnInsert: { _id, createdAt } },
        upsert: true,
      },
    }),
  );
  const result =
    operations.length === 0
      ? { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 }
      : await target.bulkWrite(operations, { ordered: true });
  const { deletedCount } = await target.deleteMany({
    sourceId: source.sourceId,
    chunkIndex: { $gte: docs.length },
  });
  return {
    inserted: result.upsertedCount,
    updated: result.modifiedCount,
    unchanged: result.matchedCount - result.modifiedCount,
    deleted: deletedCount,
  };
}
