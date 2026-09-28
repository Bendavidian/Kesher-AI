import {
  HOP_VERB,
  SHORT_NAME,
  whyYou,
  type FeedPath,
  type RelationshipType,
  type UniverseSymbol,
} from '@kesher/shared';
import type { Persona } from './types';

// The connection path layout. Every sentence comes from the shared "Why you" templates
// (packages/shared whyYou), rendered from the graph path, never by a model (principle 3).

export type LineKind = 'supplier' | 'competitor' | 'you';

export interface PathLine {
  kind: LineKind;
  label: string;
}

export interface PathStation {
  title: string;
  subtitle: string;
  // The color of the line reaching the station; the first station takes its outgoing line.
  ring: LineKind;
  you: boolean;
}

export type PathView =
  | {
      kind: 'connected';
      direct: boolean;
      stations: PathStation[];
      lines: PathLine[];
      // The accessible sentence for the full path, and a short one for the feed row.
      label: string;
      rowLabel: string;
    }
  | {
      kind: 'none';
      eventName: string;
      stations: [PathStation, PathStation];
      lineLabel: string;
      label: string;
      rowLabel: string;
      explanation: string;
    };

const HOP_LINE: Record<RelationshipType, LineKind> = {
  supplier_of: 'supplier',
  customer_of: 'supplier',
  competitor_of: 'competitor',
};

const HOLDING_LINE: PathLine = { kind: 'you', label: 'in your portfolio' };

function you(persona: Persona, ring: LineKind): PathStation {
  return { title: 'You', subtitle: persona.youLabel, ring, you: true };
}

export function buildPathView(
  path: FeedPath | null,
  eventCompany: UniverseSymbol,
  persona: Persona,
): PathView {
  const eventName = SHORT_NAME[eventCompany];
  const held = persona.holdings.map((holding) => holding.symbol);
  const why = whyYou(path, eventCompany, held);

  if (!path) {
    return {
      kind: 'none',
      eventName,
      stations: [
        { title: eventCompany, subtitle: eventName, ring: 'you', you: false },
        you(persona, 'you'),
      ],
      lineLabel: 'no connection within two stops',
      label: why.label,
      rowLabel: why.rowLabel,
      explanation: why.explanation ?? '',
    };
  }

  if (path.hops.length === 0) {
    const name = SHORT_NAME[path.holding];
    return {
      kind: 'connected',
      direct: true,
      stations: [
        { title: path.holding, subtitle: `${name}, held directly`, ring: 'you', you: false },
        you(persona, 'you'),
      ],
      lines: [HOLDING_LINE],
      label: why.label,
      rowLabel: why.rowLabel,
    };
  }

  const lines: PathLine[] = path.hops.map((hop) => ({
    kind: HOP_LINE[hop.type],
    label: HOP_VERB[hop.type],
  }));
  lines.push(HOLDING_LINE);

  const companies = [path.eventCompany, ...path.hops.map((hop) => hop.to)];
  const stations: PathStation[] = companies.map((symbol, index) => ({
    title: symbol,
    subtitle: SHORT_NAME[symbol],
    ring: (index === 0 ? lines[0] : lines[index - 1])?.kind ?? 'you',
    you: false,
  }));
  stations.push(you(persona, 'you'));

  return {
    kind: 'connected',
    direct: false,
    stations,
    lines,
    label: why.label,
    rowLabel: why.rowLabel,
  };
}
