import { createContext, useContext } from 'react';
import { httpApi, type KesherApi } from '../api/client';
import { connectFeed, type ConnectFeed } from './socket';

// The api and the socket behind the live feed. Tests provide fakes through LiveDepsContext; the
// app uses the real ones.
export interface LiveDeps {
  api: KesherApi;
  connectFeed: ConnectFeed;
}

export const LiveDepsContext = createContext<LiveDeps>({ api: httpApi, connectFeed });

export const useLiveDeps = () => useContext(LiveDepsContext);
