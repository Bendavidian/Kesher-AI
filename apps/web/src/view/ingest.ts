import type { DropReason, IngestStatus, StreamState } from '@kesher/shared';
import { formatEtShort } from './format';

// GET /ingest/status as the ticker footer shows it (docs/UI.md, Ticker footer): one summary line,
// and the rows the details panel lists. Every number here was counted by code.
export interface IngestView {
  summary: string;
  rows: { label: string; value: string }[];
}

const STREAM_LABEL: Record<StreamState, string> = {
  connecting: 'connecting',
  subscribed: 'connected',
  reconnecting: 'reconnecting',
  stopped: 'stream stopped',
};

const REASON_LABEL: Record<DropReason, string> = {
  not_in_universe: 'Outside the universe',
  duplicate: 'Duplicates',
  update: 'Updates',
  queue_full: 'Shed, queue full',
  daily_cap: 'Past the daily cap',
  extraction_failed: 'Extraction failed',
};

export function ingestView({ live, lastItemAt, today }: IngestStatus): IngestView {
  const lastItem = lastItemAt ? `last item ${formatEtShort(lastItemAt)}` : null;
  const extracted = `${today.extractions.used} of ${today.extractions.limit}`;
  const rows: IngestView['rows'] = [{ label: 'Extractions today (UTC)', value: extracted }];

  if (!live) {
    rows.push(...counterRows(today));
    return { summary: ['Live ingest off', lastItem].filter(Boolean).join(' · '), rows };
  }

  const { stream, edgar, queue } = live;
  rows.push({
    label: 'Queue',
    value: `${queue.waiting} waiting${queue.running ? ', 1 running' : ''}, at most ${queue.limit}`,
  });
  rows.push({ label: 'EDGAR', value: edgarText(edgar) });
  rows.push(...counterRows(today));
  const summary = [
    'Live',
    stream ? STREAM_LABEL[stream.state] : 'no stream',
    lastItem,
    `queue ${queue.waiting}`,
    `${extracted} extracted`,
  ];
  return { summary: summary.filter(Boolean).join(' · '), rows };
}

function edgarText(edgar: NonNullable<IngestStatus['live']>['edgar']): string {
  if (!edgar) return 'not running';
  if (edgar.pausedUntil) return `paused until ${formatEtShort(edgar.pausedUntil)}`;
  return edgar.lastPollAt ? `last poll ${formatEtShort(edgar.lastPollAt)}` : 'first poll running';
}

const counterRows = (today: IngestStatus['today']) =>
  today.counters.map(({ reason, count }) => ({
    label: REASON_LABEL[reason],
    value: count.toLocaleString('en-US'),
  }));
