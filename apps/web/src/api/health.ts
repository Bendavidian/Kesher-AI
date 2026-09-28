import { HealthResponse } from '@kesher/shared';

export type ApiStatus = 'checking' | 'ok' | 'unreachable';

export async function fetchHealth(): Promise<Exclude<ApiStatus, 'checking'>> {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) return 'unreachable';
    return HealthResponse.safeParse(await response.json()).success ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
