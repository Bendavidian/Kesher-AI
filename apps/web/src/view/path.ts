import type { FeedPath, RelationshipType, UniverseSymbol } from '@kesher/shared';
import { SHORT_NAME } from './companies';
import { joinList } from './format';
import type { Persona } from './types';

// "Why you" is rendered from the graph path with fixed templates, never by a model
// (CLAUDE.md, principle 3). Every sentence here comes from the path and the persona alone.

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

const HOP_TEMPLATE: Record<RelationshipType, { kind: LineKind; verb: string }> = {
  supplier_of: { kind: 'supplier', verb: 'supplies' },
  customer_of: { kind: 'supplier', verb: 'buys from' },
  competitor_of: { kind: 'competitor', verb: 'competes with' },
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

  if (!path) {
    const held = persona.holdings.map((holding) => holding.symbol);
    return {
      kind: 'none',
      eventName,
      stations: [
        { title: eventCompany, subtitle: eventName, ring: 'you', you: false },
        you(persona, 'you'),
      ],
      lineLabel: 'no connection within two stops',
      label: `No connection from ${eventName} to your holdings`,
      rowLabel: 'No path to your holdings',
      explanation: `You hold ${joinList(held)}. Nothing in the graph links them to ${eventName} within two stops.`,
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
      label: `You hold ${name} directly`,
      rowLabel: `You hold ${name}`,
    };
  }

  const lines: PathLine[] = path.hops.map((hop) => ({
    kind: HOP_TEMPLATE[hop.type].kind,
    label: HOP_TEMPLATE[hop.type].verb,
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

  const clauses = path.hops.map(
    (hop) => `${SHORT_NAME[hop.from]} ${HOP_TEMPLATE[hop.type].verb} ${SHORT_NAME[hop.to]}`,
  );
  const holdingName = SHORT_NAME[path.holding];
  return {
    kind: 'connected',
    direct: false,
    stations,
    lines,
    label: `${clauses.join(', ')}, and ${holdingName} is in your portfolio`,
    rowLabel: `${clauses.join(', ')}, which you hold`,
  };
}
