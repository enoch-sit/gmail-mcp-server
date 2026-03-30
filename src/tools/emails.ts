import type { gmail_v1 } from 'googleapis';
import { getGmailClient } from '../gmail/client.js';

export const emailToolDefinitions = [
  {
    name: 'list_emails',
    description:
      'List emails from Gmail. Filter by labels and/or a search query. Returns sender, subject, date, and snippet for each message.',
    inputSchema: {
      type: 'object',
      properties: {
        labelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label IDs to filter by (e.g. ["INBOX", "UNREAD"]). Defaults to INBOX.',
        },
        query: {
          type: 'string',
          description: 'Gmail search query (e.g. "from:foo@example.com is:unread")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum emails to return (default: 10, max: 50)',
        },
      },
    },
  },
  {
    name: 'read_email',
    description:
      'Read the full content of a specific email by its message ID, including headers and decoded body.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID (from list_emails or search_emails)',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'search_emails',
    description:
      'Search Gmail using the standard Gmail search syntax. Returns matching emails with sender, subject, date, and snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Gmail search query (e.g. "from:boss@company.com subject:report has:attachment")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 10, max: 50)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'download_attachment',
    description:
      'Download a specific attachment from a Gmail message. Returns the base64-encoded attachment data and its MIME type.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID containing the attachment',
        },
        attachmentId: {
          type: 'string',
          description: 'The attachment ID (from the attachments list in read_email)',
        },
      },
      required: ['messageId', 'attachmentId'],
    },
  },
];

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Direct body data
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Prefer plain text among parts
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fall back to HTML
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Recurse into multipart
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return '';
}

interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  if (!payload) return [];
  const results: AttachmentInfo[] = [];

  function walk(part: gmail_v1.Schema$MessagePart): void {
    if (part.body?.attachmentId && part.filename) {
      results.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return results;
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}

async function fetchSummaries(
  gmail: gmail_v1.Gmail,
  messages: gmail_v1.Schema$Message[],
): Promise<object[]> {
  return Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = detail.data.payload?.headers;
      return {
        id: msg.id,
        from: getHeader(headers, 'From'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        snippet: detail.data.snippet ?? '',
      };
    }),
  );
}

export async function handleEmailTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const gmail = await getGmailClient();

  if (name === 'list_emails') {
    const { labelIds, query, maxResults = 10 } = args as {
      labelIds?: string[];
      query?: string;
      maxResults?: number;
    };

    const res = await gmail.users.messages.list({
      userId: 'me',
      labelIds: labelIds ?? ['INBOX'],
      q: query,
      maxResults: Math.min(Number(maxResults), 50),
    });

    const messages = res.data.messages ?? [];
    if (messages.length === 0) return 'No emails found.';

    const summaries = await fetchSummaries(gmail, messages);
    return JSON.stringify(summaries, null, 2);
  }

  if (name === 'read_email') {
    const { messageId } = args as { messageId: string };

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = res.data.payload?.headers;
    const body = extractBody(res.data.payload);
    const attachments = extractAttachments(res.data.payload);

    return JSON.stringify(
      {
        id: res.data.id,
        threadId: res.data.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        cc: getHeader(headers, 'Cc'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        snippet: res.data.snippet ?? '',
        body,
        attachments,
        labels: res.data.labelIds ?? [],
      },
      null,
      2,
    );
  }

  if (name === 'search_emails') {
    const { query, maxResults = 10 } = args as { query: string; maxResults?: number };

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(Number(maxResults), 50),
    });

    const messages = res.data.messages ?? [];
    if (messages.length === 0) {
      return JSON.stringify({ results: [], query, message: 'No emails matched the query.' });
    }

    const summaries = await fetchSummaries(gmail, messages);
    return JSON.stringify({ results: summaries, query, total: summaries.length }, null, 2);
  }

  if (name === 'download_attachment') {
    const { messageId, attachmentId } = args as { messageId: string; attachmentId: string };

    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    return JSON.stringify(
      {
        attachmentId,
        size: res.data.size ?? 0,
        data: res.data.data, // base64url-encoded content
      },
      null,
      2,
    );
  }

  throw new Error(`Unknown email tool: ${name}`);
}
