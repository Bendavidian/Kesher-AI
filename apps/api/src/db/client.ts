import { MongoClient } from 'mongodb';

export const DB_NAME = 'kesher';

export async function connect(uri: string): Promise<MongoClient> {
  const client = new MongoClient(uri, { appName: 'kesher-api', serverSelectionTimeoutMS: 20_000 });
  await client.connect();
  return client;
}
