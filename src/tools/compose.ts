import { getGmailClient } from '../gmail/client.js';

export const composeToolDefinitions = [
  {
    name: 'send_email',
    description: 'Send an email via the authenticated Gmail account.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address(es), comma-separated',
        },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' },
        cc: {
          type: 'string',
          description: 'CC email address(es), comma-separated (optional)',
        },
        bcc: {
          type: 'string',
          description: 'BCC email address(es), comma-separated (optional)',
        },
        isHtml: {
          type: 'boolean',
          description: 'Set to true if body contains HTML markup (default: false)',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'create_draft',
    description: 'Create a draft email in Gmail without sending it.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address(es), comma-separated',
        },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Draft body (plain text or HTML)' },
        cc: { type: 'string', description: 'CC address(es), comma-separated (optional)' },
        bcc: { type: 'string', description: 'BCC address(es), comma-separated (optional)' },
        isHtml: {
          type: 'boolean',
          description: 'Set to true if body is HTML (default: false)',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'reply_to_email',
    description:
      'Reply to an existing email thread. Automatically sets Reply-To headers and preserves the thread.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID to reply to',
        },
        body: { type: 'string', description: 'Reply body (plain text or HTML)' },
        isHtml: {
          type: 'boolean',
          description: 'Set to true if body is HTML (default: false)',
        },
      },
      required: ['messageId', 'body'],
    },
  },
];

interface EmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
  inReplyTo?: string;
  references?: string;
}

function buildRawEmail(params: EmailParams): string {
  const contentType = params.isHtml ? 'text/html' : 'text/plain';
  const lines: string[] = [
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    ...(params.bcc ? [`Bcc: ${params.bcc}`] : []),
    `Subject: ${params.subject}`,
    `Content-Type: ${contentType}; charset=UTF-8`,
    `MIME-Version: 1.0`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    '',
    params.body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function handleComposeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const gmail = await getGmailClient();

  if (name === 'send_email') {
    const { to, subject, body, cc, bcc, isHtml = false } = args as {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      isHtml?: boolean;
    };

    const raw = buildRawEmail({ to, subject, body, cc, bcc, isHtml });
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return JSON.stringify(
      { success: true, messageId: res.data.id, threadId: res.data.threadId },
      null,
      2,
    );
  }

  if (name === 'create_draft') {
    const { to, subject, body, cc, bcc, isHtml = false } = args as {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      isHtml?: boolean;
    };

    const raw = buildRawEmail({ to, subject, body, cc, bcc, isHtml });
    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });

    return JSON.stringify({ success: true, draftId: res.data.id }, null, 2);
  }

  if (name === 'reply_to_email') {
    const { messageId, body, isHtml = false } = args as {
      messageId: string;
      body: string;
      isHtml?: boolean;
    };

    const original = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Message-ID', 'References'],
    });

    const headers = original.data.payload?.headers ?? [];
    const hdr = (n: string) =>
      headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? '';

    const to = hdr('From');
    const subject = `Re: ${hdr('Subject').replace(/^Re:\s*/i, '')}`;
    const inReplyTo = hdr('Message-ID');
    const references = [hdr('References'), inReplyTo].filter(Boolean).join(' ');
    const threadId = original.data.threadId ?? undefined;

    const raw = buildRawEmail({ to, subject, body, isHtml, inReplyTo, references });
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });

    return JSON.stringify(
      { success: true, messageId: res.data.id, threadId: res.data.threadId },
      null,
      2,
    );
  }

  throw new Error(`Unknown compose tool: ${name}`);
}
