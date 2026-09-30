import { z } from 'zod';

// GET /health (docs/INTERFACES.md, REST). demoMode says whether POST /demo/replay is mounted, so
// the web shows its Replay control only where it works (SPEC.md decision log, T18).
export const HealthResponse = z.object({ status: z.literal('ok'), demoMode: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponse>;
