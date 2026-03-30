import type { gmail_v1 } from 'googleapis';
import { getGmailClient } from '../gmail/client.js';
import { redactWithPolicy } from '../privacy/redaction-client.js';

export const privacyToolDefinitions = [
  {
    name: 'redact_text_local',
    description:
      'Redact sensitive content from provided text using local privacy pipeline (orchestrator with deterministic fallback).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Input text to redact.' },
        contentType: {
          type: 'string',
          description: 'Optional MIME content type for model context (default: text/plain).',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'read_email_with_privacy',
    description:
      'Read one email and return only privacy-redacted subject/snippet/body fields using the local privacy pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID to read with privacy redaction.',
        },
      },
      required: ['messageId'],
    },
  },
];

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return '';
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function handlePrivacyTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'redact_text_local') {
    const { text, contentType = 'text/plain' } = args as { text: string; contentType?: string };
    const result = await redactWithPolicy(text, contentType);

    return JSON.stringify(
      {
        redactedText: result.redactedText,
        findings: result.findings,
        engine: result.engine,
        policyVersion: result.policyVersion,
      },
      null,
      2,
    );
  }

  if (name === 'read_email_with_privacy') {
    const gmail = await getGmailClient();
    const { messageId } = args as { messageId: string };

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = res.data.payload?.headers;
    const subject = getHeader(headers, 'Subject');
    const snippet = res.data.snippet ?? '';
    const body = extractBody(res.data.payload);

    const redactedSubject = await redactWithPolicy(subject, 'text/plain');
    const redactedSnippet = await redactWithPolicy(snippet, 'text/plain');
    const redactedBody = await redactWithPolicy(body, 'text/plain');

    return JSON.stringify(
      {
        id: res.data.id,
        threadId: res.data.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        cc: getHeader(headers, 'Cc'),
        date: getHeader(headers, 'Date'),
        subject: redactedSubject.redactedText,
        snippet: redactedSnippet.redactedText,
        body: redactedBody.redactedText,
        labels: res.data.labelIds ?? [],
        privacy: {
          subjectFindings: redactedSubject.findings,
          snippetFindings: redactedSnippet.findings,
          bodyFindings: redactedBody.findings,
          engines: {
            subject: redactedSubject.engine,
            snippet: redactedSnippet.engine,
            body: redactedBody.engine,
          },
          policyVersion: redactedBody.policyVersion,
        },
      },
      null,
      2,
    );
  }

  throw new Error(`Unknown privacy tool: ${name}`);
}