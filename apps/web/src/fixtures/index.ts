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
