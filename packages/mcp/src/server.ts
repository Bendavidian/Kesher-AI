import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { authorize, type RunTokenClaims } from './token';
import { TOOLS, type ToolDefinition, type ToolDeps } from './tools';

export const SERVER_INFO = { name: 'kesher', version: '0.1.0' } as const;

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

type AnyTool = ToolDefinition<z.ZodType, z.ZodType>;

function register(server: McpServer, tool: AnyTool, deps: ToolDeps, claims: RunTokenClaims): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input): Promise<CallToolResult> => {
      // Defense in depth: an unlisted tool is never registered, and is refused here as well.
      if (!authorize(claims, tool.name)) return errorResult(`Tool ${tool.name} is not allowed`);
      // The SDK has already parsed the arguments with the tool's own input schema.
      const outcome = await tool.run(input, deps, { claims });
      if (!outcome.ok) return errorResult(outcome.error);
      return {
        content: [{ type: 'text', text: JSON.stringify(outcome.output) }],
        structuredContent: outcome.output as Record<string, unknown>,
      };
    },
  );
}

// One server per verified run token. It registers only the tools the token lists, so an
// unlisted tool is absent from tools/list and a call to it fails with "not found".
export function createKesherServer(deps: ToolDeps, claims: RunTokenClaims): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const tool of TOOLS) {
    if (authorize(claims, tool.name)) {
      register(server, tool, deps, claims);
    }
  }
  return server;
}
