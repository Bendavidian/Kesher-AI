import type { Source } from '@kesher/shared';

// What every provider adapter hands to ingestItem, replayed or live: the Source fields the
// provider owns. _id, createdAt and the injection screen are the pipeline's.
export type IncomingItem = Omit<Source, '_id' | 'createdAt' | 'injectionScreen'>;
