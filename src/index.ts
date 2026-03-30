import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { emailToolDefinitions, handleEmailTool } from './tools/emails.js';
import { composeToolDefinitions, handleComposeTool } from './tools/compose.js';
import { manageToolDefinitions, handleManageTool } from './tools/manage.js';
import { metaToolDefinitions, handleMetaTool } from './tools/meta.js';
import {
  attachmentToolDefinitions,
  handleAttachmentTool,
} from './tools/attachments.js';
import { privacyToolDefinitions, handlePrivacyTool } from './tools/privacy.js';

const server = new Server(
  { name: 'gmail-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const allTools = [
  ...emailToolDefinitions,
  ...attachmentToolDefinitions,
  ...privacyToolDefinitions,
  ...composeToolDefinitions,
  ...manageToolDefinitions,
  ...metaToolDefinitions,
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const toolArgs = args as Record<string, unknown>;

  try {
    let result: string;

    if (emailToolDefinitions.some((t) => t.name === name)) {
      result = await handleEmailTool(name, toolArgs);
    } else if (attachmentToolDefinitions.some((t) => t.name === name)) {
      result = await handleAttachmentTool(name, toolArgs);
    } else if (privacyToolDefinitions.some((t) => t.name === name)) {
      result = await handlePrivacyTool(name, toolArgs);
    } else if (composeToolDefinitions.some((t) => t.name === name)) {
      result = await handleComposeTool(name, toolArgs);
    } else if (manageToolDefinitions.some((t) => t.name === name)) {
      result = await handleManageTool(name, toolArgs);
    } else if (metaToolDefinitions.some((t) => t.name === name)) {
      result = await handleMetaTool(name, toolArgs);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Gmail MCP Server running on stdio\n');
}

main().catch((err: Error) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
