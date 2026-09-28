// The 30 event candidates for T16, picked with search.ts. Each is an Alpaca news source id
// plus its created_at and updated_at; updated_at is how the item is looked up again (the API has
// no id filter, and its time window applies to updated_at).
// Labels are proposed, from the relevance rule in SPEC.md ("Scores"): the best path from an
// event company to a holding. Direct holding 1; one hop scores the edge weight (supplier or
// customer 0.8, competitor 0.6, same sector 0.4, shared theme 0.3); two hops multiply both
// weights and 0.7. Edges are the evidence candidates in docs/research/edge-candidates.md.
// Proposed mapping: high at 0.8 or more (a holding, or one supplier or customer hop), medium
// from 0.4 to 0.8, none below 0.4.

export type EventType =
  'earnings' | 'guidance' | 'production_disruption' | 'regulation' | 'analyst_action' | 'merger';

export type Level = 'high' | 'medium' | 'none';

export interface Label {
  level: Level;
  reason: string;
}

export interface EventCandidate {
  id: number;
  createdAt: string;
  // Alpaca filters start and end on updated_at, so an item is looked up by this time.
  updatedAt: string;
  type: EventType;
  A: Label;
  B: Label;
  C: Label;
  note?: string;
}

export const PERSONAS = {
  A: 'AI investor: NVDA, MSFT, AMZN',
  B: 'Semiconductor investor: AMD, AVGO, TSM, ASML',
  C: 'Unrelated investor: KO, JNJ, XOM',
} as const;

const high = (reason: string): Label => ({ level: 'high', reason });
const medium = (reason: string): Label => ({ level: 'medium', reason });
const none = (reason: string): Label => ({ level: 'none', reason });

// Reasons that repeat.
const NO_PATH_C = none('no path from a tech company to KO, JNJ or XOM');
const NO_PATH_TECH = none('no path from KO, JNJ or XOM to a tech company');
const B_VIA_NVDA = high('NVDA customer_of TSM (inverse of TSM supplier_of NVDA), 0.8');
const B_FROM_A_SIDE = (s: string) =>
  none(`best path ${s}→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34`);
const A_VIA_TSM_SUPPLY = high('TSM supplier_of NVDA, 0.8');

export const CANDIDATES: EventCandidate[] = [
  {
    id: 38062166,
    createdAt: '2024-04-03T03:57:09Z',
    updatedAt: '2024-04-03T04:01:37Z',
    type: 'production_disruption',
    A: A_VIA_TSM_SUPPLY,
    B: high('holds TSM'),
    C: NO_PATH_C,
    note: 'The pinned demo item (DEMO_SOURCE_ID).',
  },
  {
    id: 43088007,
    createdAt: '2025-01-21T01:29:23Z',
    updatedAt: '2025-01-21T01:29:23Z',
    type: 'production_disruption',
    A: high('holds NVDA, which the item tags with TSM'),
    B: high('holds TSM'),
    C: NO_PATH_C,
    note: 'A second Taiwan earthquake: the same kind of event as the demo, a separate cluster.',
  },
  {
    id: 40152477,
    createdAt: '2024-08-05T04:08:31Z',
    updatedAt: '2024-08-05T04:52:30Z',
    type: 'production_disruption',
    A: high('holds NVDA and MSFT (both tagged)'),
    B: B_VIA_NVDA,
    C: NO_PATH_C,
    note: 'Blackwell delay; tags GOOG, GOOGL and META as well.',
  },
  {
    id: 39854612,
    createdAt: '2024-07-19T08:23:52Z',
    updatedAt: '2024-07-19T10:59:47Z',
    type: 'production_disruption',
    A: high('holds MSFT'),
    B: B_FROM_A_SIDE('MSFT'),
    C: NO_PATH_C,
    note: 'CrowdStrike update crashes Windows; CRWD is not in the universe.',
  },
  {
    id: 48297781,
    createdAt: '2025-10-20T10:16:05Z',
    updatedAt: '2025-10-20T10:16:06Z',
    type: 'production_disruption',
    A: high('holds AMZN'),
    B: B_FROM_A_SIDE('AMZN'),
    C: NO_PATH_C,
    note: 'AWS us-east-1 outage, first item of the cluster.',
  },
  {
    id: 38973532,
    createdAt: '2024-05-22T20:21:22Z',
    updatedAt: '2024-05-22T20:21:23Z',
    type: 'guidance',
    A: high('holds NVDA'),
    B: B_VIA_NVDA,
    C: NO_PATH_C,
  },
  {
    id: 41663854,
    createdAt: '2024-10-31T20:04:20Z',
    updatedAt: '2024-10-31T20:04:21Z',
    type: 'guidance',
    A: high('holds AMZN'),
    B: B_FROM_A_SIDE('AMZN'),
    C: NO_PATH_C,
  },
  {
    id: 42563518,
    createdAt: '2024-12-18T21:02:40Z',
    updatedAt: '2024-12-18T21:02:40Z',
    type: 'guidance',
    A: high('MU supplier_of NVDA, 0.8'),
    B: medium('MU→NVDA→TSM (supplier 0.8 × customer 0.8 × 0.7) is 0.45'),
    C: NO_PATH_C,
  },
  {
    id: 41336021,
    createdAt: '2024-10-15T14:35:01Z',
    updatedAt: '2024-10-15T14:35:02Z',
    type: 'guidance',
    A: medium('same sector as NVDA, 0.4; without a sector edge ASML→INTC→NVDA is 0.34'),
    B: high('holds ASML'),
    C: NO_PATH_C,
    note: 'Bookings miss and a lower 2025 range, published a day early.',
  },
  {
    id: 43320124,
    createdAt: '2025-01-29T21:30:21Z',
    updatedAt: '2025-01-29T21:30:21Z',
    type: 'earnings',
    A: high('holds MSFT'),
    B: B_FROM_A_SIDE('MSFT'),
    C: NO_PATH_C,
  },
  {
    id: 43020311,
    createdAt: '2025-01-16T05:56:57Z',
    updatedAt: '2025-01-16T05:56:57Z',
    type: 'earnings',
    A: A_VIA_TSM_SUPPLY,
    B: high('holds TSM'),
    C: NO_PATH_C,
  },
  {
    id: 42472206,
    createdAt: '2024-12-12T21:15:32Z',
    updatedAt: '2024-12-12T21:15:32Z',
    type: 'earnings',
    A: medium('AVGO competitor_of NVDA, 0.6'),
    B: high('holds AVGO'),
    C: NO_PATH_C,
  },
  {
    id: 40113523,
    createdAt: '2024-08-01T20:01:54Z',
    updatedAt: '2024-08-01T20:01:55Z',
    type: 'earnings',
    A: medium('INTC competitor_of NVDA, MSFT and AMZN, 0.6'),
    B: high('INTC customer_of TSM and of ASML, 0.8'),
    C: NO_PATH_C,
    note: 'Nobody holds INTC; it reaches both tech personas through the graph only.',
  },
  {
    id: 44828104,
    createdAt: '2025-04-15T21:27:37Z',
    updatedAt: '2025-04-15T21:27:38Z',
    type: 'regulation',
    A: high('holds NVDA'),
    B: B_VIA_NVDA,
    C: NO_PATH_C,
    note: 'H20 export license requirement and a charge of up to $5.5B.',
  },
  {
    id: 44837834,
    createdAt: '2025-04-16T13:12:26Z',
    updatedAt: '2025-04-16T13:12:26Z',
    type: 'regulation',
    A: medium('AMD competitor_of NVDA, 0.6'),
    B: high('holds AMD'),
    C: NO_PATH_C,
    note: 'Same export rule as the H20 item, seen from AMD: a cross persona pair.',
  },
  {
    id: 40748050,
    createdAt: '2024-09-06T12:12:24Z',
    updatedAt: '2024-09-06T12:12:25Z',
    type: 'regulation',
    A: medium('same sector as NVDA, 0.4; without a sector edge ASML→INTC→NVDA is 0.34'),
    B: high('holds ASML'),
    C: NO_PATH_C,
  },
  {
    id: 42276889,
    createdAt: '2024-12-02T21:11:53Z',
    updatedAt: '2024-12-02T21:11:54Z',
    type: 'regulation',
    A: medium('LRCX→TSM→NVDA and LRCX→MU→NVDA (supplier 0.8 × 0.8 × 0.7) are 0.45'),
    B: high('LRCX supplier_of TSM (inverse of TSM customer_of LRCX), 0.8'),
    C: NO_PATH_C,
    note: 'Nobody holds LRCX; the only two hop supply path for A. Lam calls the impact expected.',
  },
  {
    id: 40169246,
    createdAt: '2024-08-05T18:47:08Z',
    updatedAt: '2024-08-05T18:47:08Z',
    type: 'regulation',
    A: medium('GOOGL competitor_of NVDA, 0.6'),
    B: B_FROM_A_SIDE('GOOGL'),
    C: NO_PATH_C,
    note: 'Nobody holds GOOGL; tests how far a competitor edge should carry.',
  },
  {
    id: 39646124,
    createdAt: '2024-07-05T12:51:31Z',
    updatedAt: '2024-07-05T12:51:31Z',
    type: 'analyst_action',
    A: high('holds NVDA'),
    B: B_VIA_NVDA,
    C: NO_PATH_C,
  },
  {
    id: 44859693,
    createdAt: '2025-04-17T10:49:56Z',
    updatedAt: '2025-04-17T10:49:56Z',
    type: 'analyst_action',
    A: high('holds MSFT'),
    B: B_FROM_A_SIDE('MSFT'),
    C: NO_PATH_C,
  },
  {
    id: 39245673,
    createdAt: '2024-06-10T09:10:53Z',
    updatedAt: '2024-06-10T09:10:53Z',
    type: 'analyst_action',
    A: medium('AMD competitor_of NVDA, 0.6'),
    B: high('holds AMD'),
    C: NO_PATH_C,
  },
  {
    id: 42482634,
    createdAt: '2024-12-13T13:05:51Z',
    updatedAt: '2024-12-13T13:05:52Z',
    type: 'analyst_action',
    A: medium('AVGO competitor_of NVDA, 0.6'),
    B: high('holds AVGO'),
    C: NO_PATH_C,
    note: 'Routine: rating maintained, target raised. Rubric importance 1, so no research.',
  },
  {
    id: 40436151,
    createdAt: '2024-08-19T10:04:20Z',
    updatedAt: '2024-08-19T10:04:21Z',
    type: 'merger',
    A: medium('AMD competitor_of NVDA, 0.6'),
    B: high('holds AMD'),
    C: NO_PATH_C,
  },
  {
    id: 40964871,
    createdAt: '2024-09-20T19:26:53Z',
    updatedAt: '2024-09-20T19:26:54Z',
    type: 'merger',
    A: medium('QCOM and INTC competitor_of NVDA, 0.6'),
    B: high('QCOM and INTC customer_of TSM, 0.8'),
    C: NO_PATH_C,
    note: 'A reported approach, not a deal.',
  },
  {
    id: 47734379,
    createdAt: '2025-09-18T11:04:01Z',
    updatedAt: '2025-09-18T11:04:02Z',
    type: 'merger',
    A: high('holds NVDA'),
    B: high('NVDA and INTC customer_of TSM, 0.8'),
    C: NO_PATH_C,
    note: 'Strategic equity investment and product partnership, not an acquisition.',
  },
  {
    id: 38612606,
    createdAt: '2024-05-03T12:45:17Z',
    updatedAt: '2024-05-03T12:45:18Z',
    type: 'merger',
    A: NO_PATH_TECH,
    B: NO_PATH_TECH,
    C: high('holds XOM'),
  },
  {
    id: 42940226,
    createdAt: '2025-01-13T11:33:50Z',
    updatedAt: '2025-01-13T11:33:51Z',
    type: 'merger',
    A: NO_PATH_TECH,
    B: NO_PATH_TECH,
    C: high('holds JNJ'),
  },
  {
    id: 43618741,
    createdAt: '2025-02-11T11:55:39Z',
    updatedAt: '2025-02-11T11:55:39Z',
    type: 'earnings',
    A: NO_PATH_TECH,
    B: NO_PATH_TECH,
    C: high('holds KO'),
  },
  {
    id: 44578823,
    createdAt: '2025-04-01T07:17:14Z',
    updatedAt: '2025-04-01T07:17:14Z',
    type: 'regulation',
    A: NO_PATH_TECH,
    B: NO_PATH_TECH,
    C: high('holds JNJ'),
    note: 'Bankruptcy court rejects the talc plan; the first item Alpaca has for it.',
  },
  {
    id: 42456879,
    createdAt: '2024-12-12T11:42:24Z',
    updatedAt: '2024-12-12T11:42:24Z',
    type: 'analyst_action',
    A: NO_PATH_TECH,
    B: NO_PATH_TECH,
    C: high('holds KO'),
  },
];
