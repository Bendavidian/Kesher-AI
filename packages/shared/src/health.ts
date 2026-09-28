import { z } from 'zod';

// GET /health (docs/INTERFACES.md, REST).
export const HealthResponse = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponse>;
