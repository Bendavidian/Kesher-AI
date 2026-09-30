import { AGENT_TOOLS, mintRunToken, RUN_TOKEN_TTL_SECONDS, type ToolName } from '@kesher/mcp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// The research agent's tools, reached as a real MCP client over POST /mcp with a run token
// (docs/INTERFACES.md). The token carries the user; nothing here passes a user id to a tool.

// The research agent's tool set (AGENT_TOOLS in packages/shared), all read only.
export const RESEARCH_TOOLS: readonly ToolName[] = AGENT_TOOLS.research;

// The tools a run gets on this server. Without the local embedding model (LOCAL_EMBEDDINGS off,
// SPEC.md decision log T18) search_filings cannot embed its query, so it is left out of the token
// and the prompt: the model never spends a step on a tool that cannot work. search_news stays,
// with its word list alone.
export function researchTools({ filingSearch }: { filingSearch: boolean }): ToolName[] {
  return RESEARCH_TOOLS.filter((name) => filingSearch || name !== 'search_filings');
}

// A token this old is replaced before the next tool call, so no call runs on one about to expire.
export const TOKEN_REFRESH_AFTER_MS = (RUN_TOKEN_TTL_SECONDS - 60) * 1000;

export interface ToolSpec {
  name: string;
  description: string;
  // JSON Schema from tools/list.
  inputSchema: Record<string, unknown>;
}

// output is the tool's structuredContent, or its error text. Either way it is untrusted data.
export interface ToolOutcome {
  ok: boolean;
  output: unknown;
}

export interface TokenIssued {
  kind: 'issued' | 'refreshed';
  agent: 'research';
  tools: ToolName[];
  ttlSeconds: number;
  issuedAt: Date;
  latencyMs: number;
}

export interface Toolbox {
  tools: ToolSpec[];
  call(name: string, input: unknown): Promise<ToolOutcome>;
  close(): Promise<void>;
}

export interface ToolboxOptions {
  url: string;
  secret: string;
  // From the auth context (or the dev script), never from a model. It goes into the token only.
  userId: string;
  // The tools the run token lists, a subset of RESEARCH_TOOLS; all of them when unset.
  tools?: readonly ToolName[];
  now?: () => number;
  // Each token issued or refreshed is recorded as a run step.
  onToken: (event: TokenIssued) => Promise<void>;
}

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((part: { type?: string; text?: string }) => (part.type === 'text' ? part.text : ''))
        .join('\n')
    : '';

export async function openToolbox({
  url,
  secret,
  userId,
  tools: scope = RESEARCH_TOOLS,
  now = Date.now,
  onToken,
}: ToolboxOptions): Promise<Toolbox> {
  async function connect(kind: TokenIssued['kind']) {
    const start = now();
    const issuedAt = new Date(start);
    const token = await mintRunToken(
      secret,
      { userId, agent: 'research', tools: [...scope] },
      issuedAt,
    );
    const client = new Client({ name: 'kesher-research', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    try {
      await onToken({
        kind,
        agent: 'research',
        tools: [...scope],
        ttlSeconds: RUN_TOKEN_TTL_SECONDS,
        issuedAt,
        latencyMs: now() - start,
      });
    } catch (error) {
      await client.close();
      throw error;
    }
    return { client, issuedAt: start };
  }

  let current = await connect('issued');
  try {
    const listed = await current.client.listTools();
    const tools = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
    }));

    return {
      tools,
      async call(name, input) {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          return { ok: false, output: 'Tool arguments must be a JSON object.' };
        }
        if (now() - current.issuedAt >= TOKEN_REFRESH_AFTER_MS) {
          await current.client.close();
          current = await connect('refreshed');
        }
        try {
          const result = await current.client.callTool({
            name,
            arguments: input as Record<string, unknown>,
          });
          if (result.isError) return { ok: false, output: textOf(result.content) };
          return { ok: true, output: result.structuredContent ?? textOf(result.content) };
        } catch (error) {
          // A tool the token does not list fails here with "not found".
          return { ok: false, output: error instanceof Error ? error.message : 'tool call failed' };
        }
      },
      close: () => current.client.close(),
    };
  } catch (error) {
    await current.client.close();
    throw error;
  }
}
