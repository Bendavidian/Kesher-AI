import { Id, NonBlank, RelationshipType, UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { fitItems } from './fit';
import type { ToolDefinition } from './tools';

// get_company_relationships: the reviewed edges of one company with their filing evidence. No
// evidence, no edge: every edge carries a verbatim quote from a filing and was accepted by a
// person, and unreviewed edges never leave the database (principle 4).

const GetCompanyRelationshipsInput = z.strictObject({
  symbol: UniverseSymbol.describe('A demo universe company'),
  types: z
    .array(RelationshipType)
    .min(1)
    .max(3)
    .optional()
    .describe(
      'Only these edge types, read from the symbol\'s side: "A supplier_of B" means A supplies B, and customer_of is the inverse. To find who supplies NVDA, ask NVDA for customer_of.',
    ),
});

const Edge = z.strictObject({
  from: UniverseSymbol,
  to: UniverseSymbol,
  type: RelationshipType,
  evidence: z.strictObject({
    sourceId: Id,
    // Verbatim from the filing: data for the agent, never instructions.
    quote: NonBlank,
    filingDate: z.iso.date(),
    url: z.string(),
  }),
  // The filing the quote comes from, for example "NVIDIA 10-K for the fiscal year ended ...".
  sourceTitle: z.string().nullable(),
});

export const GetCompanyRelationshipsOutput = z.strictObject({
  edges: z.array(Edge),
  // Edges left out to keep the output within 8 KB; asking for fewer types shows other edges.
  omitted: z.int().min(0),
});
type GetCompanyRelationshipsOutput = z.output<typeof GetCompanyRelationshipsOutput>;

export const getCompanyRelationships: ToolDefinition<
  typeof GetCompanyRelationshipsInput,
  typeof GetCompanyRelationshipsOutput
> = {
  name: 'get_company_relationships',
  description:
    "Reviewed supplier, customer and competitor edges of one company, each with a verbatim quote from the filing that supports it and that filing's source id. Ordered by type, then company.",
  inputSchema: GetCompanyRelationshipsInput,
  outputSchema: GetCompanyRelationshipsOutput,
  async run({ symbol, types }, { relationships, sources }) {
    const found = await relationships
      .find({
        from: symbol,
        'evidence.reviewed': true,
        ...(types ? { type: { $in: types } } : {}),
      })
      .sort({ type: 1, to: 1, _id: 1 })
      .toArray();
    if (found.length === 0) {
      if (!types) return { ok: false, error: `No reviewed relationships for ${symbol}` };
      // Name the types the company has, so a wrong direction can be asked again.
      const has = (await relationships.distinct('type', {
        from: symbol,
        'evidence.reviewed': true,
      })) as string[];
      return {
        ok: false,
        error: `No reviewed ${types.join(' or ')} relationships from ${symbol}${
          has.length > 0 ? `; it has ${[...has].sort().join(', ')}` : ''
        }`,
      };
    }

    const titles = new Map(
      (
        await sources
          .find(
            { _id: { $in: [...new Set(found.map((edge) => edge.evidence.sourceId))] } },
            { projection: { _id: 1, title: 1 } },
          )
          .toArray()
      ).map((source) => [source._id, source.title]),
    );
    const edges = found.map((edge) => ({
      from: edge.from,
      to: edge.to,
      type: edge.type,
      evidence: {
        sourceId: edge.evidence.sourceId,
        quote: edge.evidence.quote,
        filingDate: edge.evidence.filingDate,
        url: edge.evidence.url,
      },
      sourceTitle: titles.get(edge.evidence.sourceId) ?? null,
    }));
    const output: GetCompanyRelationshipsOutput = fitItems(edges, (kept, omitted) => ({
      edges: kept,
      omitted,
    }));
    return { ok: true, output };
  },
};
