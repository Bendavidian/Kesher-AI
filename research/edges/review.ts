// Step 2: the review of every candidate from find.ts, keyed by candidate id.
// An edge reads "from <type> to": "TSM supplier_of NVDA" means TSMC supplies NVIDIA. The type
// is the role the sentence gives, in the direction it states; T11 adds the inverse edges.
// accept: the sentence names the company and states the role (supplier, foundry, "manufactured
// by", "we purchase from", customer, competitor, "compete with").
// borderline: the company is named and a supply relationship is described without a role
// word. Listed for the human review, not counted.
// reject: the reason the candidate is not evidence.
// pick marks the one quote proposed as the evidence of each accepted edge.
// quote replaces the sentence with a longer verbatim span when the role is stated in the
// sentence just before it; report.ts checks the span against the filing text.
import type { Ticker } from './universe';

export type EdgeType = 'supplier_of' | 'customer_of' | 'competitor_of';

export interface Edge {
  from: Ticker;
  type: EdgeType;
  to: Ticker;
  pick?: true;
}

export interface Decision {
  accept?: Edge[];
  borderline?: Edge[];
  reject?: string;
  quote?: string;
  note?: string;
}

const BIO = 'Executive biography, not a company relationship';
const NO_ROLE = 'Names the company without a supplier, customer or competitor role';
const PLATFORM = 'Platform or software dependency, not a supplier, customer or competitor role';
const PARTNER = 'Partnership or equity investment, not a supplier, customer or competitor role';
const CONDITIONAL = 'Conditional future arrangement, not a current relationship';
const THIRD = 'States a relationship between the company and third parties, not the filer';
const IMPLIED = 'Role implied by the context, not stated in the sentence';
const BOILERPLATE = 'Trademark or disclosure boilerplate';

const sup = (from: Ticker, to: Ticker, pick?: true): Edge => ({
  from,
  type: 'supplier_of',
  to,
  pick,
});
const cus = (from: Ticker, to: Ticker, pick?: true): Edge => ({
  from,
  type: 'customer_of',
  to,
  pick,
});
const com = (from: Ticker, to: Ticker, pick?: true): Edge => ({
  from,
  type: 'competitor_of',
  to,
  pick,
});

export const REVIEW: Record<string, Decision> = {
  // NVDA 10-K
  eef07e7249: { accept: [sup('TSM', 'NVDA', true)] },
  '5b4c5b141c': { accept: [sup('MU', 'NVDA', true)] },
  '4c15d2a9a1': {
    accept: [
      com('AMD', 'NVDA', true),
      com('INTC', 'NVDA', true),
      com('GOOGL', 'NVDA', true),
      com('AMZN', 'NVDA', true),
      com('MSFT', 'NVDA', true),
      com('AVGO', 'NVDA', true),
      com('QCOM', 'NVDA', true),
    ],
    note: 'One list sentence; the lead-in "Our current competitors include:" covers every bullet.',
  },
  dcf9b1aa67: { reject: BIO },
  '1fb410878e': { reject: BIO },
  '85d8ab3701': { reject: BIO },
  '677468a5bb': { reject: NO_ROLE },
  '774f158772': { reject: NO_ROLE },
  '49d065c365': { reject: NO_ROLE },

  // GOOGL 10-K
  '65bdbc93d0': { reject: BOILERPLATE },

  // META 10-K
  b08f9b513f: { reject: PLATFORM },
  '0fcad54851': { reject: PLATFORM },
  '1d9350c456': { reject: PLATFORM },
  db72569071: { reject: PLATFORM },
  d7abd1d937: {
    accept: [com('GOOGL', 'META', true)],
    note: '"competitive products" integrated with Android.',
  },
  '6d57c189c8': { reject: PLATFORM },

  // AMD 10-K
  b67ea326b9: { reject: NO_ROLE },
  '78fec076b6': {
    borderline: [sup('AMD', 'MSFT')],
    note: 'AMD semi-custom SoCs power the Microsoft Xbox; no supplier or customer word.',
  },
  a1d0e5f880: { accept: [com('INTC', 'AMD'), com('NVDA', 'AMD', true)] },
  d07e3ae817: { accept: [com('INTC', 'AMD', true)] },
  b7c4121dc8: { accept: [com('NVDA', 'AMD'), com('INTC', 'AMD')] },
  d0c3a85345: { reject: IMPLIED },
  f1e6d6228f: { accept: [com('AVGO', 'AMD', true), com('QCOM', 'AMD', true), com('NVDA', 'AMD')] },
  '2ec4b89669': { accept: [com('INTC', 'AMD')] },
  '4f33b85a06': { accept: [sup('TSM', 'AMD')] },
  '874ee71399': { accept: [sup('TSM', 'AMD')] },
  '0540ca26d9': { reject: BOILERPLATE },
  cbcea53c9b: { reject: PLATFORM },
  '866949f63b': { reject: IMPLIED, note: 'Competitive conduct without the role word.' },
  '0ca04db66e': { reject: IMPLIED, note: 'Competitive conduct without the role word.' },
  '0aabf5c317': { reject: PARTNER, note: 'NVIDIA and Intel partnership, reported by AMD.' },
  fdb86daf0a: {
    borderline: [sup('AMD', 'MSFT')],
    note: 'Consoles "for Sony and Microsoft" in the semi-custom pipeline; no role word.',
  },
  '9ff417b958': { accept: [sup('TSM', 'AMD', true)] },
  c755a28b2e: { accept: [sup('TSM', 'AMD')] },
  '2eec092823': { accept: [sup('TSM', 'AMD')] },
  '8f79f8b6e9': { reject: IMPLIED },
  '08d98b428b': { accept: [sup('TSM', 'AMD')] },
  '8bd625f387': { accept: [sup('TSM', 'AMD')] },
  '57f6c1b3b2': { accept: [sup('TSM', 'AMD')] },
  e3fb789e23: { reject: NO_ROLE },
  a3ac28ddd5: { reject: PLATFORM },
  '4e04e84893': { reject: PLATFORM },
  c210aa3285: { reject: PLATFORM },
  '269737d0e4': { reject: PLATFORM },
  b675e7981b: { reject: PLATFORM },

  // AVGO 10-K
  cab24d9884: { accept: [sup('TSM', 'AVGO', true)] },
  '3886a1cbbf': { accept: [sup('TSM', 'AVGO')] },
  eb26478ad4: { accept: [sup('TSM', 'AVGO')] },
  a135f1d4fb: { reject: IMPLIED },
  e71289304a: { accept: [sup('TSM', 'AVGO')] },
  d2605fafb3: { accept: [sup('TSM', 'AVGO')] },

  // INTC 10-K
  ff9b691167: { reject: PARTNER },
  b04d5cc8ef: { reject: CONDITIONAL },
  da56129d81: { accept: [com('AMD', 'INTC', true)] },
  '7529aba220': { accept: [com('QCOM', 'INTC', true)] },
  e10a588e77: {
    accept: [
      com('AMD', 'INTC'),
      com('NVDA', 'INTC', true),
      com('AMZN', 'INTC', true),
      com('GOOGL', 'INTC', true),
      com('META', 'INTC', true),
      com('MSFT', 'INTC', true),
    ],
    note: 'Hyperscalers are named as competitors for their custom silicon.',
  },
  '43cc8f6869': { accept: [com('AVGO', 'INTC', true)] },
  d8353a4179: { reject: IMPLIED },
  '225a74d672': { accept: [com('TSM', 'INTC', true)] },
  '13e9b71520': { accept: [sup('TSM', 'INTC'), com('TSM', 'INTC')] },
  aa7d3d8a85: { accept: [sup('TSM', 'INTC')] },
  '70b20aab09': { accept: [sup('ASML', 'INTC')] },
  f00255d0eb: { reject: PARTNER },
  '12207e5125': { accept: [com('AMD', 'INTC'), com('QCOM', 'INTC'), com('NVDA', 'INTC')] },
  e828933020: { reject: THIRD },
  '1da833708e': { accept: [com('TSM', 'INTC')] },
  '4266823b7c': { reject: THIRD },
  dab6d95ce4: { accept: [sup('TSM', 'INTC'), com('TSM', 'INTC')] },
  f3c2a3fba9: { accept: [sup('TSM', 'INTC')] },
  e276628934: { reject: CONDITIONAL },
  '500180bb5c': { reject: IMPLIED },
  '81b888dd13': { reject: THIRD },
  '84cf17bca5': {
    reject: IMPLIED,
    note: 'Names TSMC as able to make the nodes, not as making them.',
  },
  '418950dd29': { accept: [sup('ASML', 'INTC', true)] },
  '7ebeaf8824': { accept: [sup('TSM', 'INTC', true)] },

  // QCOM 10-K
  fe73db4da4: { accept: [sup('TSM', 'QCOM', true)] },
  '720eca0b6d': {
    accept: [com('AVGO', 'QCOM', true), com('NVDA', 'QCOM', true)],
    quote:
      'Companies that provide on-device AI, high-performance and low-power computing and wireless connectivity-based integrated circuit products and/or software are generally competitors or potential competitors. Examples (some of which are strategic partners of ours in other areas) include Broadcom, HiSilicon, MediaTek, Mobileye, Nvidia, NXP Semiconductors, Qorvo, Samsung, Skyworks, Texas Instruments and UNISOC.',
    note: 'The role is in the sentence before the list, so the quote spans both sentences.',
  },

  // AMAT 10-K
  f97c3b0576: { reject: BIO },
  '5ad1f2dd86': { reject: BIO },

  // LRCX 10-K
  aef96b1462: { accept: [cus('MU', 'LRCX', true), cus('TSM', 'LRCX', true)] },
  '1913cc92b7': { accept: [com('AMAT', 'LRCX', true)] },
  b3a8caa5ef: { accept: [com('AMAT', 'LRCX')] },
  '6c879fdfe6': { reject: BIO },
  '6be4ee7083': { reject: BIO },
  '5416c83b0a': { reject: BIO },
};
