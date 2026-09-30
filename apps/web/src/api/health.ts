import { HealthResponse } from '@kesher/shared';

export type ApiStatus = 'checking' | 'ok' | 'unreachable';

export interface Health {
  status: Exclude<ApiStatus, 'checking'>;
  // POST /demo/replay is mounted, so the Replay control works (DEMO_MODE on the api).
  demoMode: boolean;
}

const UNREACHABLE: Health = { status: 'unreachable', demoMode: false };

export async function fetchHealth(): Promise<Health> {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) return UNREACHABLE;
    const parsed = HealthResponse.safeParse(await response.json());
    return parsed.success ? { status: 'ok', demoMode: parsed.data.demoMode } : UNREACHABLE;
  } catch {
    return UNREACHABLE;
  }
}
