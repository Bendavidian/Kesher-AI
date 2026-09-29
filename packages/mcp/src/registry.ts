import { getMyPortfolio } from './portfolio';
import { getEvent, getPriceReaction, searchNews } from './tools';

// Every tool the server implements. The run token decides which of them a caller sees.
export const TOOLS = [getMyPortfolio, getEvent, searchNews, getPriceReaction] as const;
