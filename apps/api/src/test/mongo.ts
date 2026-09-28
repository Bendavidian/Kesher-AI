import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server-core';

// The Atlas server line recorded in docs/SPIKE.md. The CI cache key for the downloaded binary
// uses the same version.
export const MONGOD_VERSION = '8.0.32';

// The first run on a machine downloads mongod (about 100 MB) into ~/.cache/mongodb-binaries.
export const MONGO_START_TIMEOUT_MS = 180_000;

export interface TestMongo {
  db: Db;
  stop(): Promise<void>;
}

// A throwaway mongod for integration tests. Tests never touch Atlas.
export async function startTestMongo(dbName: string): Promise<TestMongo> {
  const server = await MongoMemoryServer.create({ binary: { version: MONGOD_VERSION } });
  const client = await MongoClient.connect(server.getUri());
  return {
    db: client.db(dbName),
    async stop() {
      await client.close();
      try {
        await server.stop();
      } catch {
        // Windows can hold the data files briefly; cleanup is best effort.
      }
    },
  };
}
