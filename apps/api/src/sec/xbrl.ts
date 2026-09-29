import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CompanyConceptSource, ConceptFacts } from '@kesher/mcp';
import type { UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { FILERS } from '../graph/filers';
import { SecHttpError, type Fetcher } from './fetch';

// SEC XBRL values for get_financial_facts, from the companyconcept API: one us-gaap concept of
// one filer per request. Validated with zod at the boundary; only the fields the tool uses are
// kept. Tests read the committed recordings in recordings/sec-xbrl and never call SEC.

export const XBRL_RECORDINGS_DIR = resolve(import.meta.dirname, '../../../../recordings/sec-xbrl');

// Kept in process for this long, so an agent run and the next ones ask SEC once per concept.
export const XBRL_CACHE_MS = 12 * 60 * 60 * 1000;

const Fact = z.object({
  start: z.iso.date().optional(),
  end: z.iso.date(),
  val: z.number(),
  accn: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  fy: z.int().nullable().optional(),
  fp: z.string().nullable().optional(),
  form: z.string().min(1),
  filed: z.iso.date(),
  frame: z.string().optional(),
});

const CompanyConcept = z.object({
  cik: z.int().positive(),
  taxonomy: z.literal('us-gaap'),
  tag: z.string().min(1),
  units: z.record(z.string(), z.array(Fact)),
});

export function parseCompanyConcept(json: string): ConceptFacts {
  const concept = CompanyConcept.parse(JSON.parse(json));
  return {
    cik: String(concept.cik).padStart(10, '0'),
    concept: concept.tag,
    units: Object.fromEntries(
      Object.entries(concept.units).map(([unit, facts]) => [
        unit,
        facts.map((fact) => ({
          start: fact.start ?? null,
          end: fact.end,
          val: fact.val,
          accn: fact.accn,
          fy: fact.fy ?? null,
          fp: fact.fp ?? null,
          form: fact.form,
          filed: fact.filed,
          frame: fact.frame ?? null,
        })),
      ]),
    ),
  };
}

export const conceptUrl = (cik: string, concept: string) =>
  `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;

// The raw answer for one concept of one symbol, or null when SEC has none.
export type ConceptReader = (symbol: UniverseSymbol, concept: string) => Promise<string | null>;

// Live: each CIK of the filer in turn (XOM has a newer holding company CIK, BACKLOG.md T11); a
// 404 on every one means the filer does not report the concept.
export function secConcepts(get: () => Fetcher): ConceptReader {
  return async (symbol, concept) => {
    const ciks = FILERS.find((filer) => filer.symbol === symbol)?.ciks ?? [];
    for (const cik of ciks) {
      try {
        return await get()(conceptUrl(cik, concept), 'application/json');
      } catch (error) {
        if (!(error instanceof SecHttpError && error.status === 404)) throw error;
      }
    }
    return null;
  };
}

export const recordingPath = (symbol: string, concept: string, dir = XBRL_RECORDINGS_DIR) =>
  join(dir, symbol, `${concept}.json`);

// Recorded: the file npm run record:xbrl wrote, which holds null for a concept SEC had none of.
// A concept never recorded is an error, so a test cannot pass by silently finding nothing.
export function recordedConcepts(dir = XBRL_RECORDINGS_DIR): ConceptReader {
  return async (symbol, concept) => {
    const file = recordingPath(symbol, concept, dir);
    if (!existsSync(file)) throw new Error(`no XBRL recording for ${symbol} ${concept}`);
    const text = await readFile(file, 'utf8');
    return text.trim() === 'null' ? null : text;
  };
}

export function createCompanyConcepts(
  read: ConceptReader,
  now: () => number = Date.now,
): CompanyConceptSource {
  const cache = new Map<string, { at: number; facts: Promise<ConceptFacts | null> }>();
  return (symbol, concept) => {
    const key = `${symbol}/${concept}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < XBRL_CACHE_MS) return hit.facts;
    const facts = read(symbol, concept).then((json) =>
      json === null ? null : parseCompanyConcept(json),
    );
    cache.set(key, { at: now(), facts });
    // A failure is not kept, so the next call asks again.
    facts.catch(() => cache.delete(key));
    return facts;
  };
}
