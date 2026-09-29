import { PriceSymbol, PriceWindowName } from '@kesher/shared';
import { z } from 'zod';

// The report the research model submits through submit_report. It is flat on purpose, so both
// providers accept its JSON schema; code maps each draft claim to a typed Claim and checks it
// (checks.ts). Keys are local to one draft: premises name other claims by key.
export const MAX_DRAFT_CLAIMS = 12;

const ClaimKey = z.string().regex(/^c\d{1,2}$/);

export const DraftClaim = z.strictObject({
  key: ClaimKey.describe('A local key for this claim: c1, c2 and so on'),
  type: z
    .enum(['fact', 'metric', 'inference'])
    .describe(
      'fact: stated by a source, with a verbatim quote. metric: price moves from get_price_reaction, listed in figures. inference: your reasoning from other claims, in hedged language.',
    ),
  text: z.string().trim().min(1).max(500).describe('The claim in one sentence'),
  sources: z
    .array(
      z.strictObject({
        sourceId: z.string().describe('The sourceId of an item a tool returned'),
        quote: z
          .string()
          .optional()
          .describe('Text copied exactly, character for character, from that source'),
      }),
    )
    .max(5),
  premises: z.array(ClaimKey).max(5).describe('For an inference: the keys of the claims it uses'),
  figures: z
    .array(
      z.strictObject({
        symbol: PriceSymbol,
        window: PriceWindowName,
        pct: z.number().describe('The pct get_price_reaction returned, unchanged'),
      }),
    )
    // No maxItems: Gemini rejects the request when this nested array has one next to the other
    // tools. Claim caps figures at 12, so a longer list drops the claim. Required, like premises,
    // because a model left an optional list out of its metrics.
    .describe(
      'For a metric: every price move its text gives, as get_price_reaction returned it. Empty for other types.',
    ),
});
export type DraftClaim = z.infer<typeof DraftClaim>;

export const ReportDraft = z
  .strictObject({
    claims: z.array(DraftClaim).min(1).max(MAX_DRAFT_CLAIMS),
    openQuestions: z
      .array(z.string().trim().min(1).max(300))
      .max(5)
      .describe('What the sources do not answer yet'),
  })
  .refine((draft) => new Set(draft.claims.map((c) => c.key)).size === draft.claims.length, {
    error: 'each claim key appears once',
    path: ['claims'],
  });
export type ReportDraft = z.infer<typeof ReportDraft>;

// The input schema the model sees for submit_report.
export const REPORT_DRAFT_JSON_SCHEMA = z.toJSONSchema(ReportDraft, { target: 'draft-7' });
