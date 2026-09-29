import { GetPriceReactionOutput, priceReactionFromJson } from '@kesher/mcp';
import type { Db } from 'mongodb';
import { upsertPriceReactionSource } from '../sources/marketData';

// After a successful tool call, code stores the Sources its output names that may not be stored
// yet, under the ids the output gave (SPEC.md decision log, T13). The MCP tools stay read only;
// this runs in the research agent, as every other database write of a run does. Answers the ids
// it stored.
export async function storeToolSources(
  db: Db,
  toolName: string,
  output: unknown,
  now: Date,
): Promise<string[]> {
  if (toolName === 'get_price_reaction') {
    // The output comes from our own MCP server; a shape it does not have stores nothing.
    const parsed = GetPriceReactionOutput.safeParse(output);
    if (!parsed.success) return [];
    return [await upsertPriceReactionSource(db, priceReactionFromJson(parsed.data), now)];
  }
  return [];
}
