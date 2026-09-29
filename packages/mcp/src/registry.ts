import { getMyPortfolio } from './portfolio';
import { getCompanyRelationships } from './relationships';
import { getEvent, getPriceReaction, searchNews } from './tools';

// Every tool the server implements. The run token decides which of them a caller sees.
export const TOOLS = [
  getMyPortfolio,
  getEvent,
  searchNews,
  getCompanyRelationships,
  getPriceReaction,
] as const;
