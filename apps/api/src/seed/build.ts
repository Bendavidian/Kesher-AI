import { randomUUID } from 'node:crypto';
import { Company, EDGE_WEIGHTS, Relationship, Source, User, withInverse } from '@kesher/shared';
import { hashPassword } from '../auth/password';
import { COMPANIES, DEMO_PASSWORD, EDGES, FILINGS, PERSONAS } from './config';

// Every builder parses what it returns, so nothing leaves here without passing its schema.
// Fresh _ids are only used on insert; a rerun keeps the stored ones ($setOnInsert).

export function buildSources(now: Date): Source[] {
  return Object.values(FILINGS).map(({ source }) =>
    Source.parse({ _id: randomUUID(), ...source, createdAt: now }),
  );
}

export function buildCompanies(now: Date): Company[] {
  return COMPANIES.map((company) =>
    Company.parse({ _id: randomUUID(), ...company, createdAt: now }),
  );
}

export async function buildUsers(now: Date): Promise<User[]> {
  return Promise.all(
    PERSONAS.map(async (persona) =>
      User.parse({
        _id: randomUUID(),
        ...persona,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        createdAt: now,
      }),
    ),
  );
}

// sourceIds maps an EDGAR accession number to the stored Source._id, read back from the
// database so evidence always points at the Source that exists.
export function buildRelationships(
  now: Date,
  sourceIds: ReadonlyMap<string, string>,
): Relationship[] {
  return EDGES.flatMap(({ from, to, type, filing, quote }) => {
    const {
      filingDate,
      source: { externalId, url },
    } = FILINGS[filing];
    const sourceId = sourceIds.get(externalId);
    if (!sourceId) throw new Error(`no Source for filing ${externalId}; seed sources first`);
    const evidence = { sourceId, quote, filingDate, url, reviewed: true };
    return withInverse({ from, to, type, weight: EDGE_WEIGHTS[type], evidence }).map((edge) =>
      Relationship.parse({ _id: randomUUID(), ...edge, createdAt: now }),
    );
  });
}
