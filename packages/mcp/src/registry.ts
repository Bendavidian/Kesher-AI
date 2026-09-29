import { searchFilings } from './filings';
import { searchNews } from './news';
import { getMyPortfolio } from './portfolio';
import { getCompanyRelationships } from './relationships';
import { getEvent, getPriceReaction } from './tools';

// Every tool the server implements. The run token decides which of them a caller sees.
export const TOOLS = [
  getMyPortfolio,
  getEvent,
  searchNews,
  searchFilings,
  getCompanyRelationships,
  getPriceReaction,
] as const;
