import type { FixtureStore } from '../view/feed';
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

export { PERSONAS } from './personas';

// Everything the feed screen reads until T06 wiring replaces it with the api and Socket.IO.
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

// The demo research report and its agent run, until T08 and T09 read them from the api.
export const DEMO_RESEARCH = {
  runs: [DEMO_RUN],
  reports: [DEMO_REPORT],
  claims: DEMO_CLAIMS,
  sources: DEMO_REPORT_SOURCES,
  stepOutputs: { [DEMO_RUN._id]: DEMO_STEP_OUTPUTS },
  tokenScopes: { [DEMO_RUN._id]: DEMO_TOKEN_SCOPE },
};
