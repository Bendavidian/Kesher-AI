import {
  GetCompanyRelationshipsOutput,
  GetFinancialFactsOutput,
  SearchFilingsOutput,
} from '@kesher/mcp';
import type { Db } from 'mongodb';
import { upsertFilingSource } from '../sources/filings';

// After a successful tool call, code stores the Sources its output names that may not be stored
// yet, under the ids the output gave (SPEC.md decision log, T13): the filings get_financial_facts
// cites. The market data Source of a metric is written after the report (marketSource.ts, T14).
// The MCP tools stay read only; this runs in the research agent, as every other database write of
// a run does. Answers the ids it stored.
export async function storeToolSources(
  db: Db,
  toolName: string,
  output: unknown,
  now: Date,
): Promise<string[]> {
  if (toolName === 'get_financial_facts') {
    const parsed = GetFinancialFactsOutput.safeParse(output);
    if (!parsed.success) return [];
    const stored: string[] = [];
    for (const filing of parsed.data.filings) {
      stored.push(await upsertFilingSource(db, parsed.data.symbol, filing, now));
    }
    return stored;
  }
  return [];
}

// Filing text a tool returned in this run, by the source it belongs to: the passages of
// search_filings and the evidence quotes of get_company_relationships. A filing Source keeps text
// null, so a fact quoting a filing is checked against these (SPEC.md decision log, T13). Only text
// that reached the model in this run counts.
export function collectPassages(
  toolName: string,
  output: unknown,
  into: Map<string, string[]>,
): Map<string, string[]> {
  const add = (sourceId: string, text: string) =>
    into.set(sourceId, [...(into.get(sourceId) ?? []), text]);
  if (toolName === 'search_filings') {
    const parsed = SearchFilingsOutput.safeParse(output);
    if (parsed.success) for (const p of parsed.data.passages) add(p.sourceId, p.text);
  } else if (toolName === 'get_company_relationships') {
    const parsed = GetCompanyRelationshipsOutput.safeParse(output);
    if (parsed.success) {
      for (const edge of parsed.data.edges) add(edge.evidence.sourceId, edge.evidence.quote);
    }
  }
  return into;
}

// Joins the returned passages between markers, so a quote never matches across two of them.
export const PASSAGE_SEPARATOR = '\n[…]\n';

// The source as the checks and the verifier read it. A filing, whose Source keeps text null, gets
// the passages a tool returned for it in this run as its text; a source with text keeps it.
export function withPassages<S extends { text: string | null }>(
  source: S,
  passages: readonly string[] | undefined,
): S {
  if (source.text !== null || !passages || passages.length === 0) return source;
  return { ...source, text: [...new Set(passages)].join(PASSAGE_SEPARATOR) };
}
