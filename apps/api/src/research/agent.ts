import { randomUUID } from 'node:crypto';
import {
  AgentRun,
  AgentStep,
  PriceReactionError,
  Report,
  type PriceReaction,
  type PriceSymbol,
  type RunEnded,
  type RunFailureReason,
  type RunStepPushed,
  type TokenUsage,
  type ToolName,
  VERIFIER_STEP,
} from '@kesher/shared';
import { jsonSchema, tool, type ModelMessage, type ToolResultPart, type ToolSet } from 'ai';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { RunRateLimitError, type ModelClient, type RunStepResult } from '../llm/client';
import { estimateTokens, planTurn, STEP_BUDGET, TOKEN_BUDGET, type RunMode } from './budget';
import type { PriceReactions } from '../market/reactions';
import { checkDraft, DETERMINISTIC_CHECKS, type CheckedDraft } from './checks';
import { REPORT_DRAFT_JSON_SCHEMA, ReportDraft } from './draft';
import { upsertMarketSource } from './marketSource';
import { openToolbox, RESEARCH_TOOLS, type TokenIssued, type Toolbox } from './mcp';
import { capStepOutput } from './output';
import { buildBrief, quoteToolOutput, REPORT_TOOL, researchSystem } from './prompt';
import type { RecordedTurn, RecordedVerifierCall } from './recordings';
import { collectPassages, storeToolSources, withPassages } from './toolSources';
import { applyVerdicts, VERIFIER_TOKEN_CAP, verifyClaims, type VerifierCall } from './verifier';

// The research agent (SPEC.md Research agent). The model reads and proposes; code runs every tool
// call through MCP, decides every turn and every budget, checks the claims and does every write.

export interface ResearchDeps {
  db: Db;
  models: ModelClient;
  // POST /mcp and the secret that signs run tokens.
  mcp: { url: string; secret: string };
  // Applied to every step before it is stored.
  redact: (text: string) => string;
  // Step times and token age. The model client keeps its own clock for waits.
  now?: () => number;
  newId?: () => string;
  // Each raw model turn and verifier call, for npm run research:dev -- --record.
  onTurn?: (turn: RecordedTurn) => void;
  onVerifierCall?: (call: RecordedVerifierCall) => void;
  // The price reaction the api serves (createPriceReactions). numbers_match reads it at the
  // event's time; without it a metric's figures stay unchecked and the metric unverified.
  priceReactions?: PriceReactions;
  // Each step once it is stored, and the final status once the run is finished, for run:step
  // and run:end to the run's user. A push that fails is logged and never stops the run.
  onStep?: (userId: string, pushed: RunStepPushed) => Promise<void> | void;
  onEnd?: (userId: string, ended: RunEnded) => Promise<void> | void;
  // Where a background failure goes, such as a failed push. Redacted by the server.
  logError?: (error: unknown) => void;
  // The tools a run gets, for its token and its prompt: RESEARCH_TOOLS when unset. The server
  // leaves out search_filings without the local embedding model (researchTools).
  tools?: readonly ToolName[];
}

export interface ResearchRequest {
  // From the auth context (T08 part 2) or the dev script; never from a model. It is used to load
  // the user's path and to mint the run token, and never enters a prompt.
  userId: string;
  eventId: string;
  mode: RunMode;
  trigger: AgentRun['trigger'];
  gateReason: string;
  // The id for the AgentRun, when the caller has already put it on the card (Investigate).
  runId?: string;
}

export interface ResearchOutcome {
  runId: string;
  status: AgentRun['status'];
  failureReason: RunFailureReason | null;
  reportId: string | null;
}

// The request cannot start a run: nothing is written.
export class ResearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchInputError';
  }
}

// A report that fails its schema gets one more chance, then the run fails.
const MAX_REPORT_ATTEMPTS = 2;
const REPORT_SECTION = 'Claims';

// A step before it is capped and stored, per kind.
type StepInput = AgentStep extends infer S
  ? S extends AgentStep
    ? Omit<S, 'output' | 'outputTruncated' | 'startedAt'> & { output: unknown; startedAt: number }
    : never
  : never;

// Every sourceId a tool returned: get_event's sourceIds and search_news items.
export function collectSourceIds(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectSourceIds(v, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'sourceId' && typeof v === 'string') into.add(v);
      else if (key === 'sourceIds' && Array.isArray(v)) {
        for (const id of v) if (typeof id === 'string') into.add(id);
      } else collectSourceIds(v, into);
    }
  }
  return into;
}

function summarizeTool(name: string, ok: boolean, output: unknown): string {
  if (!ok) return `Error: ${String(output).slice(0, 200)}`;
  const record = (output ?? {}) as { items?: unknown[]; headline?: string; sourceIds?: unknown[] };
  if (Array.isArray(record.items)) return `${record.items.length} items.`;
  if (typeof record.headline === 'string') {
    return `Loaded the event with ${record.sourceIds?.length ?? 0} sources.`;
  }
  return `${name} answered.`;
}

// A turn with unknown usage is charged its estimate and its full output cap.
function turnTokens(result: RunStepResult, promptTokens: number, maxOutput: number): TokenUsage {
  const input = result.usage.inputTokens ?? promptTokens;
  const output = result.usage.outputTokens ?? maxOutput;
  return { input, output, total: result.usage.totalTokens ?? input + output };
}

export async function runResearch(
  deps: ResearchDeps,
  request: ResearchRequest,
): Promise<ResearchOutcome> {
  const { db, models, redact } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const runs = collection(db, 'agent_runs');

  const [item, user, event] = await Promise.all([
    collection(db, 'feed_items').findOne({ userId: request.userId, eventId: request.eventId }),
    collection(db, 'users').findOne({ _id: request.userId }),
    collection(db, 'market_events').findOne(
      { _id: request.eventId },
      { projection: { embedding: 0 } },
    ),
  ]);
  if (!user || !event) throw new ResearchInputError('unknown user or event');
  if (!item?.path) throw new ResearchInputError('the event has no path to this user');
  const path = item.path;

  const stepBudget = STEP_BUDGET[request.mode];
  const tokenBudget = TOKEN_BUDGET[request.mode];
  const ref = models.pickRunProvider(tokenBudget);
  const runId = request.runId ?? newId();
  const createdAt = new Date(now());
  await runs.insertOne(
    AgentRun.parse({
      _id: runId,
      userId: request.userId,
      eventId: request.eventId,
      agent: 'research',
      mode: request.mode,
      trigger: request.trigger,
      gate: { decision: 'run', reason: request.gateReason },
      stepBudget,
      tokenBudget,
      steps: [],
      tokensUsed: 0,
      verification: { tokenCap: VERIFIER_TOKEN_CAP, tokensUsed: 0 },
      costUsd: 0,
      status: 'running',
      failureReason: null,
      startedAt: createdAt,
      finishedAt: null,
      createdAt,
    }),
  );

  // A redaction that breaks the JSON keeps the input as redacted text instead.
  const redactInput = (input: Record<string, unknown>): Record<string, unknown> => {
    const text = redact(JSON.stringify(input));
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { redacted: text };
    }
  };

  const push = async (send: () => Promise<void> | void) => {
    try {
      await send();
    } catch (error) {
      deps.logError?.(error);
    }
  };

  let tokensUsed = 0;
  let stepCount = 0;
  // Written as it happens, redacted, output capped at 8 KB, then pushed as run:step. The count is
  // the step's place in AgentRun.steps only while steps are recorded one at a time: every caller
  // awaits record, and none may start two at once. A client that sees a gap reads the run again.
  // A model step counts against the research budget, or against the verifier's cap.
  async function record(
    step: StepInput,
    account: 'research' | 'verifier' = 'research',
  ): Promise<void> {
    const { output, outputTruncated } = capStepOutput(step.output, redact);
    const stored = AgentStep.parse({
      ...step,
      input: redactInput(step.input),
      outputSummary: redact(step.outputSummary),
      output,
      outputTruncated,
      startedAt: new Date(step.startedAt),
    });
    const tokens = stored.kind === 'model' ? stored.tokens.total : 0;
    const counter = account === 'research' ? 'tokensUsed' : 'verification.tokensUsed';
    await runs.updateOne(
      { _id: runId },
      { $push: { steps: stored }, ...(tokens > 0 ? { $inc: { [counter]: tokens } } : {}) },
    );
    const index = stepCount;
    stepCount += 1;
    await push(() => deps.onStep?.(request.userId, { runId, index, step: stored }));
  }

  async function finish(
    status: AgentRun['status'],
    failureReason: RunFailureReason | null = null,
    reportId: string | null = null,
  ): Promise<ResearchOutcome> {
    await runs.updateOne(
      { _id: runId },
      { $set: { status, failureReason, finishedAt: new Date(now()) } },
    );
    await push(() => deps.onEnd?.(request.userId, { runId, status }));
    return { runId, status, failureReason, reportId };
  }

  const onToken = (issued: TokenIssued) =>
    record({
      kind: 'code',
      name: issued.kind === 'issued' ? 'Run token issued' : 'Run token refreshed',
      input: { agent: issued.agent, tools: issued.tools, ttlSeconds: issued.ttlSeconds },
      outputSummary: `Research agent, ${issued.tools.join(' and ')}, read only, valid for ${issued.ttlSeconds / 60} minutes.`,
      output: {
        issuedAt: issued.issuedAt.toISOString(),
        expiresAt: new Date(issued.issuedAt.getTime() + issued.ttlSeconds * 1000).toISOString(),
      },
      startedAt: issued.issuedAt.getTime(),
      latencyMs: issued.latencyMs,
    });

  // The event's price reaction at the event's own time, for numbers_match. A failure leaves the
  // figures unchecked; the reason is recorded, and only a PriceReactionError's own text is kept.
  async function readReaction(
    subjects: PriceSymbol[],
    headline: Date,
  ): Promise<PriceReaction | null> {
    const started = now();
    let reaction: PriceReaction | null = null;
    let problem: string | null = null;
    if (!deps.priceReactions) problem = 'Market data is not configured.';
    else {
      try {
        reaction = await deps.priceReactions(subjects, headline);
      } catch (error) {
        if (!(error instanceof PriceReactionError)) deps.logError?.(error);
        problem =
          error instanceof PriceReactionError ? error.message : 'Market data is unavailable.';
      }
    }
    await record({
      kind: 'code',
      name: 'Market data read',
      input: { symbols: subjects, eventTime: headline.toISOString() },
      outputSummary: reaction
        ? `Price reaction anchored to the ${reaction.anchor.kind === 'headline' ? 'headline' : 'previous close'}, trading day ${reaction.anchor.tradingDay}.`
        : `${problem} Metric figures stay unchecked.`,
      output: reaction ?? { error: problem },
      startedAt: started,
      latencyMs: now() - started,
    });
    return reaction;
  }

  // One check step, recorded only when the check ran on a claim. Its output lists the claims it
  // removed, which is what turns the step red in the run screen.
  async function recordCheck(
    name: (typeof DETERMINISTIC_CHECKS)[number],
    checked: Pick<CheckedDraft, 'claims'>,
    removed: string[],
    startedAt: number,
    extra: Record<string, unknown>,
    only?: string[],
  ): Promise<void> {
    const ran = checked.claims.filter(
      (c) => (!only || only.includes(c._id)) && c.checks.some((check) => check.name === name),
    );
    if (ran.length === 0 && Object.keys(extra).length === 0) return;
    await record({
      kind: 'check',
      name,
      input: { claims: ran.length },
      outputSummary:
        removed.length === 0
          ? `${ran.length} checked, none removed.`
          : `${ran.length} checked, ${removed.length} removed.`,
      output: {
        removedClaimIds: removed,
        failures: ran.flatMap((c) =>
          c.checks
            .filter((check) => check.name === name && !check.passed)
            .map((check) => ({ claimId: c._id, detail: check.detail })),
        ),
        ...extra,
      },
      startedAt,
      latencyMs: now() - startedAt,
    });
  }

  // Each verifier call is a model step on the verifier's own cap, or a code step when it failed.
  async function recordVerifierCall(call: VerifierCall): Promise<void> {
    deps.onVerifierCall?.(
      call.ok
        ? {
            text: call.text,
            usage: {
              inputTokens: call.usage.inputTokens ?? null,
              outputTokens: call.usage.outputTokens ?? null,
              totalTokens: call.usage.totalTokens ?? null,
            },
          }
        : { error: call.error },
    );
    const input = {
      claims: call.claimIds.length,
      estimatedTokens: call.estimatedTokens,
      tokenCap: VERIFIER_TOKEN_CAP,
    };
    if (!call.ok) {
      await record({
        kind: 'code',
        name: 'Verifier failed',
        input,
        outputSummary: `${call.error}. ${call.claimIds.length} claims stay unverified and hidden.`,
        output: { claimIds: call.claimIds, error: call.error },
        startedAt: call.startedAt,
        latencyMs: call.latencyMs,
      });
      return;
    }
    const supported = call.answer.verdicts.filter((v) => v.verdict === 'supported').length;
    const inputTokens = call.usage.inputTokens ?? call.estimatedTokens;
    const outputTokens = call.usage.outputTokens ?? Math.max(0, call.tokens - inputTokens);
    await record(
      {
        kind: 'model',
        name: VERIFIER_STEP,
        input,
        outputSummary: `${supported} supported, ${call.answer.verdicts.length - supported} unsupported.`,
        output: { claimIds: call.claimIds, verdicts: call.answer.verdicts },
        provider: call.provider,
        model: call.model,
        tokens: { input: inputTokens, output: outputTokens, total: call.tokens },
        startedAt: call.startedAt,
        latencyMs: call.latencyMs,
      },
      'verifier',
    );
  }

  // From here on every path ends the run with finish, so no run stays running.
  let toolbox: Toolbox | undefined;
  try {
    const at = now();
    await record({
      kind: 'code',
      name: 'Gate check',
      input: { trigger: request.trigger, eventId: request.eventId },
      outputSummary: request.gateReason,
      output: { decision: 'run', reason: request.gateReason },
      startedAt: at,
      latencyMs: 0,
    });
    await record({
      kind: 'code',
      name: 'Provider picked',
      input: { tokenBudget },
      outputSummary: `${ref.provider} ${ref.model} for the whole run.`,
      output: ref,
      startedAt: at,
      latencyMs: 0,
    });

    toolbox = await openToolbox({
      url: deps.mcp.url,
      secret: deps.mcp.secret,
      userId: request.userId,
      ...(deps.tools ? { tools: deps.tools } : {}),
      now,
      onToken,
    });

    const tools: ToolSet = {};
    for (const spec of toolbox.tools) {
      tools[spec.name] = tool({
        description: spec.description,
        inputSchema: jsonSchema(spec.inputSchema),
      });
    }
    tools[REPORT_TOOL] = tool({
      description: 'Submit the final report. Call it once, when you are done.',
      inputSchema: jsonSchema(REPORT_DRAFT_JSON_SCHEMA as Record<string, unknown>),
    });
    const toolNames = new Set(toolbox.tools.map((t) => t.name));
    // The prompt names only the tools this run has.
    const system = researchSystem(deps.tools ?? RESEARCH_TOOLS);
    const toolsText = JSON.stringify([
      ...toolbox.tools,
      { name: REPORT_TOOL, schema: REPORT_DRAFT_JSON_SCHEMA },
    ]);

    const held = user.holdings.map((h) => h.symbol);
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: buildBrief({ eventId: event._id, path, held, stepBudget }),
      },
    ];

    const seen = new Set<string>();
    const passages = new Map<string, string[]>();
    let toolCallsUsed = 0;
    let reportAttempts = 0;
    let mustReport = false;
    let draft: ReportDraft | null = null;

    for (let turn = 1; draft === null; turn++) {
      const promptTokens = estimateTokens(system + toolsText + JSON.stringify(messages));
      const plan = planTurn({ stepBudget, tokenBudget, toolCallsUsed, tokensUsed, promptTokens });
      if (reportAttempts >= MAX_REPORT_ATTEMPTS) {
        return await finish('failed', 'invalid_report');
      }
      if (plan.kind === 'stop') {
        await record({
          kind: 'code',
          name: 'Budget spent',
          input: { toolCallsUsed, tokensUsed, tokenBudget, promptTokens },
          outputSummary: 'Not enough tokens left for a report; the run stops without one.',
          output: { toolCallsUsed, tokensUsed },
          startedAt: now(),
          latencyMs: 0,
        });
        return await finish('budget_exhausted');
      }
      const reportTurn = plan.kind === 'report' || mustReport;
      const reason = plan.kind === 'report' ? plan.reason : mustReport ? 'model_done' : null;

      const started = now();
      const result = await models.runStep(
        ref,
        {
          system,
          messages,
          tools,
          toolChoice: reportTurn ? { type: 'tool', toolName: REPORT_TOOL } : 'required',
          maxOutputTokens: plan.maxOutputTokens,
          estimatedInputTokens: promptTokens,
        },
        (wait) =>
          record({
            kind: 'code',
            name: 'Rate limit wait',
            input: { provider: wait.provider, model: wait.model, attempt: wait.attempt },
            outputSummary: `429 from ${wait.provider}; waiting ${Math.round(wait.waitMs / 1000)} s, then retry ${wait.attempt} of 3 on the same provider.`,
            output: { waitMs: wait.waitMs },
            startedAt: now(),
            latencyMs: 0,
          }),
      );
      const tokens = turnTokens(result, promptTokens, plan.maxOutputTokens);
      tokensUsed += tokens.total;
      await record({
        kind: 'model',
        name: reportTurn ? 'Report turn' : `Research turn ${turn}`,
        input: {
          turn,
          toolChoice: reportTurn ? REPORT_TOOL : 'required',
          ...(reason ? { reason } : {}),
          maxOutputTokens: plan.maxOutputTokens,
          estimatedInputTokens: promptTokens,
        },
        outputSummary: `${
          result.toolCalls.length === 0
            ? 'No tool call.'
            : `Called ${result.toolCalls.map((c) => c.toolName).join(', ')}.`
        }${result.toolChoiceViolated ? ' Ignored the required tool; usage estimated.' : ''}`,
        output: {
          text: result.text,
          toolCalls: result.toolCalls,
          ...(result.toolChoiceViolated ? { toolChoiceViolated: true } : {}),
        },
        provider: result.provider,
        model: result.model,
        tokens,
        startedAt: started,
        latencyMs: now() - started,
      });
      deps.onTurn?.({
        text: result.text,
        toolCalls: result.toolCalls.map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: JSON.stringify(c.input),
        })),
        finishReason: result.finishReason,
        usage: {
          inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null,
          totalTokens: result.usage.totalTokens ?? null,
        },
      });
      // The model skipped the tool it had to call. Nothing of this turn enters the history or
      // runs; a skipped report counts as a failed attempt.
      if (result.toolChoiceViolated) {
        if (reportTurn) {
          reportAttempts++;
          await record({
            kind: 'code',
            name: 'Report rejected',
            input: { attempt: reportAttempts },
            outputSummary: `The model did not call ${REPORT_TOOL}.`,
            output: { toolCalls: result.toolCalls.map((c) => c.toolName) },
            startedAt: now(),
            latencyMs: 0,
          });
        }
        mustReport = true;
        continue;
      }
      messages.push(...result.responseMessages);

      // A valid report ends the run, and no other call of that turn runs. An invalid one, or a
      // report turn without one, counts as a failed attempt.
      const reportCall = result.toolCalls.find((c) => c.toolName === REPORT_TOOL);
      if (reportCall || reportTurn) {
        reportAttempts++;
        const parsed = ReportDraft.safeParse(reportCall?.input);
        if (parsed.success) {
          draft = parsed.data;
          break;
        }
        await record({
          kind: 'code',
          name: 'Report rejected',
          input: { attempt: reportAttempts },
          outputSummary: reportCall
            ? 'The report did not match its schema.'
            : `The model did not call ${REPORT_TOOL}.`,
          output: reportCall
            ? parsed.error.issues.slice(0, 10)
            : { toolCalls: result.toolCalls.map((c) => c.toolName) },
          startedAt: now(),
          latencyMs: 0,
        });
      }

      const results: ToolResultPart[] = [];
      for (const call of result.toolCalls) {
        const reply = (value: string, ok: boolean) =>
          results.push({
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: ok ? { type: 'text', value } : { type: 'error-text', value },
          });
        if (call.toolName === REPORT_TOOL) {
          reply('The report did not match its schema. Submit it again, fixed.', false);
          continue;
        }
        if (reportTurn || toolCallsUsed >= stepBudget) {
          reply('Not run: the tool call budget is spent. Submit the report now.', false);
          continue;
        }
        toolCallsUsed++;
        const callStarted = now();
        // The tool name is model text: only a name the token lists reaches MCP, a step name or
        // the quote around the output.
        if (!toolNames.has(call.toolName)) {
          await record({
            kind: 'tool',
            name: 'unknown_tool',
            input: { toolName: call.toolName },
            outputSummary: 'Not run: the run token lists no such tool.',
            output: 'Not run: the run token lists no such tool.',
            startedAt: callStarted,
            latencyMs: 0,
          });
          reply('Not run: no such tool.', false);
          continue;
        }
        const outcome = await toolbox.call(call.toolName, call.input);
        if (outcome.ok) {
          collectSourceIds(outcome.output, seen);
          // The same output the model reads below; tools keep it within 8 KB, so nothing is cut.
          collectPassages(call.toolName, outcome.output, passages);
        }
        const stored = outcome.ok
          ? await storeToolSources(db, call.toolName, outcome.output, new Date(now())).catch(
              (error: unknown) => error,
            )
          : [];
        await record({
          kind: 'tool',
          name: call.toolName,
          input: (call.input ?? {}) as Record<string, unknown>,
          outputSummary: summarizeTool(call.toolName, outcome.ok, outcome.output),
          output: outcome.output,
          startedAt: callStarted,
          latencyMs: now() - callStarted,
        });
        if (!Array.isArray(stored)) {
          // A claim that cites this source will fail sources_exist; the run goes on.
          await record({
            kind: 'code',
            name: 'Source not stored',
            input: { toolName: call.toolName },
            outputSummary: 'The source this tool named could not be stored.',
            output: String(stored),
            startedAt: now(),
            latencyMs: 0,
          });
        }
        const payload =
          typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output);
        reply(quoteToolOutput(call.toolName, payload), outcome.ok);
      }
      if (results.length > 0) messages.push({ role: 'tool', content: results });
      mustReport = reportCall !== undefined || result.toolCalls.length === 0;
    }

    // The report: code checks every claim against the sources the tools returned and the market
    // data it reads itself, then the verifier judges the claims the checks kept.
    const checksStarted = now();
    const sources = await collection(db, 'sources')
      .find({ _id: { $in: [...seen] } }, { projection: { title: 1, text: 1 } })
      .toArray();
    // A filing keeps text null; what a tool returned from it in this run stands in, so the quote
    // check and the verifier read exactly what the model read.
    const seenSources = new Map(sources.map((s) => [s._id, withPassages(s, passages.get(s._id))]));
    const reportId = newId();

    const figures = draft.claims.flatMap((c) => (c.type === 'metric' ? c.figures : []));
    const subjects = [...new Set(figures.map((f) => f.symbol))];
    let reaction: PriceReaction | null = null;
    let marketSourceId: string | null = null;
    if (figures.length > 0) {
      reaction = await readReaction(subjects, event.publishedAt);
      marketSourceId = await upsertMarketSource(db, event._id, subjects, {
        now: new Date(checksStarted),
        newId,
      });
    }

    const checked = checkDraft(draft, {
      seen: seenSources,
      reportId,
      newId,
      now: new Date(checksStarted),
      reaction,
      marketSourceId,
    });
    for (const name of DETERMINISTIC_CHECKS) {
      await recordCheck(name, checked, checked.removedBy[name], checksStarted, {
        ...(name === 'no_advice' && checked.droppedQuestions.length > 0
          ? { droppedOpenQuestions: checked.droppedQuestions }
          : {}),
      });
    }
    if (checked.dropped.length > 0) {
      await record({
        kind: 'code',
        name: 'Draft claims dropped',
        input: { claims: draft.claims.length },
        outputSummary: `${checked.dropped.length} draft claims could not form a claim.`,
        output: checked.dropped,
        startedAt: checksStarted,
        latencyMs: 0,
      });
    }

    const verified = await verifyClaims(
      models,
      { claims: checked.claims, sources: seenSources, reaction, tokenCap: VERIFIER_TOKEN_CAP },
      { now, onCall: recordVerifierCall },
    );
    const verifyStarted = now();
    const applied = applyVerdicts(checked.claims, checked.keys, verified.verdicts);
    if (verified.verdicts.size > 0) {
      const judged = applied.claims.filter((c) => verified.verdicts.has(c._id));
      await record({
        kind: 'check',
        name: 'verifier',
        input: { claims: judged.length },
        outputSummary: `${judged.length} checked, ${applied.removedBy.verifier.length === 0 ? 'none' : applied.removedBy.verifier.length} removed.`,
        output: {
          removedClaimIds: applied.removedBy.verifier,
          supportedClaimIds: judged
            .filter((c) => verified.verdicts.get(c._id)?.verdict === 'supported')
            .map((c) => c._id),
          failures: judged.flatMap((c) =>
            c.checks
              .filter((check) => check.name === 'verifier' && !check.passed)
              .map((check) => ({ claimId: c._id, detail: check.detail })),
          ),
        },
        startedAt: verifyStarted,
        latencyMs: 0,
      });
    }
    if (applied.removedBy.premises_supported.length > 0) {
      await recordCheck(
        'premises_supported',
        { ...checked, claims: applied.claims },
        applied.removedBy.premises_supported,
        verifyStarted,
        {},
        applied.removedBy.premises_supported,
      );
    }
    if (verified.left.length > 0) {
      await record({
        kind: 'code',
        name: 'Claims not verified',
        input: { claims: verified.left.length, tokenCap: VERIFIER_TOKEN_CAP },
        outputSummary: `${verified.left.length} claims stay unverified and hidden: ${verified.left[0]?.reason}.`,
        output: verified.left,
        startedAt: verifyStarted,
        latencyMs: 0,
      });
    }
    const finalClaims = applied.claims;

    // Claims first, then the report that lists them. Claims left without a report are removed.
    const claims = collection(db, 'claims');
    if (finalClaims.length > 0) await claims.insertMany(finalClaims);
    try {
      await collection(db, 'reports').insertOne(
        Report.parse({
          _id: reportId,
          runId,
          sections:
            finalClaims.length > 0
              ? [{ title: REPORT_SECTION, claimIds: finalClaims.map((c) => c._id) }]
              : [],
          openQuestions: checked.openQuestions,
          createdAt: new Date(now()),
        }),
      );
    } catch (error) {
      await claims.deleteMany({ reportId }).catch(() => undefined);
      throw error;
    }
    return await finish('succeeded', null, reportId);
  } catch (error) {
    // Best effort: the step may not be written when the database is the problem, but finish is
    // still tried, so the run does not stay running.
    const rateLimited = error instanceof RunRateLimitError;
    await record(
      rateLimited
        ? {
            kind: 'code',
            name: 'Rate limited',
            input: { provider: error.ref.provider, model: error.ref.model, retries: error.retries },
            outputSummary: `${error.message}. The run ends without a report.`,
            output: { reason: error.reason, waitMs: error.waitMs, retries: error.retries },
            startedAt: now(),
            latencyMs: 0,
          }
        : {
            kind: 'code',
            name: 'Run error',
            input: {},
            outputSummary: error instanceof Error ? error.message : 'the run failed',
            output: error instanceof Error ? error.message : String(error),
            startedAt: now(),
            latencyMs: 0,
          },
    ).catch(() => undefined);
    return await finish('failed', rateLimited ? 'rate_limited' : 'error');
  } finally {
    await toolbox?.close().catch(() => undefined);
  }
}
