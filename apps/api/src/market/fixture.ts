import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PriceReaction } from '@kesher/shared';
import { z } from 'zod';
import { AlpacaNewsId, RECORDINGS_DIR } from '../ingest/recordings';

// The computed PriceReaction of a recorded item: moves and base prices only, no raw bars. It is
// committed as a test fixture (SPEC.md decision log, T13); npm run record:bars -- --event writes it.
export const REACTIONS_DIR = join(RECORDINGS_DIR, 'price-reactions');

export const reactionFixturePath = (externalId: string, dir = REACTIONS_DIR) =>
  join(dir, `${AlpacaNewsId.parse(externalId)}.json`);

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const ReactionFixture = z.strictObject({
  provider: z.literal('alpaca'),
  externalId: AlpacaNewsId,
  recordedAt: z.date(),
  reaction: PriceReaction,
});
export type ReactionFixture = z.infer<typeof ReactionFixture>;

// A PriceReaction written as JSON, with its times as ISO strings, parsed back with dates.
export function reviveReaction(json: unknown): PriceReaction {
  return PriceReaction.parse(
    JSON.parse(JSON.stringify(json), (_key, value: unknown) =>
      typeof value === 'string' && ISO_DATE_TIME.test(value) ? new Date(value) : value,
    ),
  );
}

export async function loadReactionFixture(
  externalId: string,
  dir = REACTIONS_DIR,
): Promise<ReactionFixture> {
  const text = await readFile(reactionFixturePath(externalId, dir), 'utf8');
  // Times were written as ISO strings; they become dates again before the schema parses them.
  const json: unknown = JSON.parse(text, (_key, value: unknown) =>
    typeof value === 'string' && ISO_DATE_TIME.test(value) ? new Date(value) : value,
  );
  const fixture = ReactionFixture.parse(json);
  if (fixture.externalId !== externalId) {
    throw new Error(`fixture ${externalId} holds ${fixture.externalId}`);
  }
  return fixture;
}
