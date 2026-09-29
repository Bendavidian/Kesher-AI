import { MongoServerError } from 'mongodb';

const DUPLICATE_KEY = 11000;

// Concurrent first upserts of one unique key can fail with E11000; tried again, the write finds
// the document the winner inserted.
export async function retryOnDuplicateKey<T>(write: () => Promise<T>): Promise<T> {
  return write().catch((error: unknown) => {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return write();
    throw error;
  });
}
