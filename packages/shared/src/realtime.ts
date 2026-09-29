import { z } from 'zod';
import { Id } from './domain/common';
import { AgentRun, AgentStep } from './domain/research';

// Socket.IO events (docs/INTERFACES.md). The server sends each one to the signed in user only,
// except event:scored, which names an event and carries nothing about any user.
export const SOCKET_EVENTS = {
  feedItem: 'feed:item',
  feedUpdate: 'feed:update',
  eventScored: 'event:scored',
  runStep: 'run:step',
  runEnd: 'run:end',
} as const;

// An event was scored for every user. A client with no card for it can ask
// GET /events/:eventId/explain why it stays out of that user's feed.
export const EventScored = z.strictObject({ eventId: Id });
export type EventScored = z.infer<typeof EventScored>;

// run:step: a step one of the user's runs just wrote, as stored. index is its 0-based place in
// AgentRun.steps. The client sends nothing, so every run of the user is pushed and the run
// screen keeps the steps of the run it shows.
export const RunStepPushed = z.strictObject({
  runId: Id,
  index: z.int().min(0),
  step: AgentStep,
});
export type RunStepPushed = z.infer<typeof RunStepPushed>;

// run:end: the run finished with this status; GET /runs/:runId then has its final state.
export const RunEnded = z.strictObject({ runId: Id, status: AgentRun.shape.status });
export type RunEnded = z.infer<typeof RunEnded>;
