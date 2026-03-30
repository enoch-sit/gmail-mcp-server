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
        attachments: {
          type: 'array',
          description: 'Optional file attachments to include in the email.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Attachment file name (e.g. "report.pdf")' },
              mimeType: { type: 'string', description: 'MIME type (e.g. "application/pdf")' },
              data: { type: 'string', description: 'Base64-encoded file content' },
            },
            required: ['filename', 'mimeType', 'data'],
          },
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
        attachments: {
          type: 'array',
          description: 'Optional file attachments to include in the draft.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Attachment file name (e.g. "report.pdf")' },
              mimeType: { type: 'string', description: 'MIME type (e.g. "application/pdf")' },
              data: { type: 'string', description: 'Base64-encoded file content' },
            },
            required: ['filename', 'mimeType', 'data'],
          },
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
        attachments: {
          type: 'array',
          description: 'Optional file attachments to include in the reply.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Attachment file name (e.g. "report.pdf")' },
              mimeType: { type: 'string', description: 'MIME type (e.g. "application/pdf")' },
              data: { type: 'string', description: 'Base64-encoded file content' },
            },
            required: ['filename', 'mimeType', 'data'],
          },
        },
      },
      required: ['messageId', 'body'],
    },
  },
];

interface AttachmentParam {
  filename: string;
  mimeType: string;
  data: string; // base64-encoded content (standard or base64url)
}

interface EmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
  inReplyTo?: string;
  references?: string;
  attachments?: AttachmentParam[];
}

function buildRawEmail(params: EmailParams): string {
  const contentType = params.isHtml ? 'text/html' : 'text/plain';

  if (!params.attachments || params.attachments.length === 0) {
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

  // multipart/mixed for emails with attachments
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    ...(params.bcc ? [`Bcc: ${params.bcc}`] : []),
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    '',
    `--${boundary}`,
    `Content-Type: ${contentType}; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    '',
    params.body,
  ];

  for (const att of params.attachments) {
    // Accept both base64url and standard base64; normalize to standard base64
    const b64 = att.data.replace(/-/g, '+').replace(/_/g, '/');
    // Chunk into 76-char lines per RFC 2045 §6.8
    const chunks = b64.match(/.{1,76}/g) ?? [];
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      ...chunks,
    );
  }

  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function handleComposeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const gmail = await getGmailClient();

  if (name === 'send_email') {
    const { to, subject, body, cc, bcc, isHtml = false, attachments } = args as {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      isHtml?: boolean;
      attachments?: AttachmentParam[];
    };

    const raw = buildRawEmail({ to, subject, body, cc, bcc, isHtml, attachments });
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
    const { to, subject, body, cc, bcc, isHtml = false, attachments } = args as {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      isHtml?: boolean;
      attachments?: AttachmentParam[];
    };

    const raw = buildRawEmail({ to, subject, body, cc, bcc, isHtml, attachments });
    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });

    return JSON.stringify({ success: true, draftId: res.data.id }, null, 2);
  }

  if (name === 'reply_to_email') {
    const { messageId, body, isHtml = false, attachments } = args as {
      messageId: string;
      body: string;
      isHtml?: boolean;
      attachments?: AttachmentParam[];
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

    const raw = buildRawEmail({ to, subject, body, isHtml, inReplyTo, references, attachments });
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
