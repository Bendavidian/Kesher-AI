import type { Company, FeedItem, MarketEvent, Relationship, ReportDetail } from '@kesher/shared';
import type { FilingView, NewsSourceView, PriceReaction } from '../view/types';
import {
  COMPANIES,
  DEMO_EVENT,
  DEMO_NEWS_SOURCE,
  DEMO_PRICE_REACTION,
  FEED_ITEMS,
  FILINGS,
  RELATIONSHIPS,
} from './demoEvent';
import {
  DEMO_CLAIMS,
  DEMO_REPORT,
  DEMO_REPORT_SOURCES,
  DEMO_RUN,
  DEMO_STEP_OUTPUTS,
  DEMO_TOKEN_SCOPE,
} from './research';

export { PERSONAS, PUBLIC_USERS } from './personas';
import { DEMO_CARDS } from './cards';

export { DEMO_CARDS, DEMO_EXPLAINS } from './cards';

// The demo event's documents, for the report and agent run screens until T08 and T09 read them
// from the api. The feed screen reads the api and Socket.IO.
export interface FixtureStore {
  events: MarketEvent[];
  newsSources: NewsSourceView[];
  companies: Company[];
  relationships: Relationship[];
  filings: FilingView[];
  feedItems: FeedItem[];
  priceReaction: PriceReaction;
  replayedEventId: string;
}

export const DEMO_STORE: FixtureStore = {
  events: [DEMO_EVENT],
  newsSources: [DEMO_NEWS_SOURCE],
  companies: COMPANIES,
  relationships: RELATIONSHIPS,
  filings: FILINGS,
  feedItems: Object.values(FEED_ITEMS).flat(),
  priceReaction: DEMO_PRICE_REACTION,
  replayedEventId: DEMO_EVENT._id,
};

// The demo report as GET /reports/:reportId answers it for persona A, for the report screen tests.
export const DEMO_REPORT_DETAIL: ReportDetail = {
  report: DEMO_REPORT,
  claims: DEMO_CLAIMS,
  sources: DEMO_REPORT_SOURCES,
  run: DEMO_RUN,
  card: DEMO_CARDS.A[0]!,
};

// The demo research report and its agent run; the run screen reads them until T09.
export const DEMO_RESEARCH = {
  runs: [DEMO_RUN],
  reports: [DEMO_REPORT],
  claims: DEMO_CLAIMS,
  sources: DEMO_REPORT_SOURCES,
  stepOutputs: { [DEMO_RUN._id]: DEMO_STEP_OUTPUTS },
  tokenScopes: { [DEMO_RUN._id]: DEMO_TOKEN_SCOPE },
};
