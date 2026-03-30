import type { gmail_v1 } from 'googleapis';
import attachmentPolicyConfig from '../config/attachment-policy.json' with { type: 'json' };
import { getGmailClient } from '../gmail/client.js';

interface AttachmentPolicy {
  version: string;
  maxSizeMB: number;
  maxFilenameLength: number;
  allowedMimeTypes: string[];
  blockedExtensions: string[];
  downloadTimeoutMs: number;
}

interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface ValidationResult {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
}

const attachmentPolicy: AttachmentPolicy = attachmentPolicyConfig;

const attachmentToolNames = {
  list: 'list_attachments_with_safety',
  validate: 'validate_attachment',
  download: 'download_attachment_safe',
} as const;

export const attachmentToolDefinitions = [
  {
    name: attachmentToolNames.list,
    description:
      'List attachments for a message and provide policy-based safety assessment for each file.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID containing attachments',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: attachmentToolNames.validate,
    description:
      'Validate one attachment against local safety policy (size, MIME type, extension, filename).',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID containing the attachment',
        },
        attachmentId: {
          type: 'string',
          description: 'The attachment ID from read_email or list_attachments_with_safety',
        },
      },
      required: ['messageId', 'attachmentId'],
    },
  },
  {
    name: attachmentToolNames.download,
    description:
      'Safely download one validated attachment. Blocks risky files and enforces policy checks before returning data.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID containing the attachment',
        },
        attachmentId: {
          type: 'string',
          description: 'The attachment ID from read_email or list_attachments_with_safety',
        },
      },
      required: ['messageId', 'attachmentId'],
    },
  },
];

function decodeBase64UrlToBuffer(data: string): Buffer {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const missingPad = normalized.length % 4;
  const pad = missingPad === 0 ? '' : '='.repeat(4 - missingPad);
  return Buffer.from(`${normalized}${pad}`, 'base64');
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

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return '';
  return filename.slice(idx).toLowerCase();
}

function validateMetadata(info: AttachmentInfo): ValidationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const maxBytes = attachmentPolicy.maxSizeMB * 1024 * 1024;

  if (!info.filename.trim()) {
    reasons.push('Attachment filename is empty.');
  }

  if (info.filename.length > attachmentPolicy.maxFilenameLength) {
    reasons.push(
      `Attachment filename exceeds policy max (${attachmentPolicy.maxFilenameLength} chars).`,
    );
  }

  if (info.size > maxBytes) {
    reasons.push(
      `Attachment size ${info.size} bytes exceeds policy max ${maxBytes} bytes (${attachmentPolicy.maxSizeMB} MB).`,
    );
  }

  const ext = extensionOf(info.filename);
  if (ext && attachmentPolicy.blockedExtensions.includes(ext)) {
    reasons.push(`Attachment extension ${ext} is blocked by policy.`);
  }

  if (!attachmentPolicy.allowedMimeTypes.includes(info.mimeType)) {
    reasons.push(`Attachment MIME type ${info.mimeType} is not allowed by policy.`);
  }

  if (!ext) {
    warnings.push('Attachment has no file extension.');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    warnings,
  };
}

function detectMimeFromMagic(bytes: Buffer): string | null {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'application/pdf';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif';
    }
  }

  // Treat plain UTF-8 text as text/plain when all sampled bytes are printable whitespace/text.
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
  if (sample.length > 0) {
    const maybeText = sample.every(
      (b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e),
    );
    if (maybeText) {
      return 'text/plain';
    }
  }

  return null;
}

async function fetchAttachmentInfo(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentInfo> {
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const attachments = extractAttachments(message.data.payload);
  const found = attachments.find((a) => a.attachmentId === attachmentId);
  if (!found) {
    throw new Error('Attachment not found for the provided messageId and attachmentId.');
  }

  return found;
}

function throwIfRejected(result: ValidationResult): void {
  if (!result.allowed) {
    throw new Error(`Attachment blocked by policy: ${result.reasons.join(' ')}`);
  }
}

export async function handleAttachmentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const gmail = await getGmailClient();

  if (name === attachmentToolNames.list) {
    const { messageId } = args as { messageId: string };

    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const attachments = extractAttachments(message.data.payload);
    const evaluated = attachments.map((attachment) => {
      const validation = validateMetadata(attachment);
      return {
        ...attachment,
        policy: {
          allowed: validation.allowed,
          reasons: validation.reasons,
          warnings: validation.warnings,
          policyVersion: attachmentPolicy.version,
        },
      };
    });

    return JSON.stringify(
      {
        messageId,
        attachments: evaluated,
        total: evaluated.length,
      },
      null,
      2,
    );
  }

  if (name === attachmentToolNames.validate) {
    const { messageId, attachmentId } = args as {
      messageId: string;
      attachmentId: string;
    };
    const attachment = await fetchAttachmentInfo(gmail, messageId, attachmentId);
    const validation = validateMetadata(attachment);

    return JSON.stringify(
      {
        messageId,
        attachment,
        policy: {
          allowed: validation.allowed,
          reasons: validation.reasons,
          warnings: validation.warnings,
          policyVersion: attachmentPolicy.version,
        },
      },
      null,
      2,
    );
  }

  if (name === attachmentToolNames.download) {
    const { messageId, attachmentId } = args as {
      messageId: string;
      attachmentId: string;
    };

    const attachment = await fetchAttachmentInfo(gmail, messageId, attachmentId);
    const validation = validateMetadata(attachment);
    throwIfRejected(validation);

    const res = await Promise.race([
      gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Attachment download timed out after ${attachmentPolicy.downloadTimeoutMs}ms.`,
            ),
          );
        }, attachmentPolicy.downloadTimeoutMs);
      }),
    ]);

    const encoded = res.data.data ?? '';
    if (!encoded) {
      throw new Error('Attachment download returned empty data.');
    }

    const bytes = decodeBase64UrlToBuffer(encoded);
    const maxBytes = attachmentPolicy.maxSizeMB * 1024 * 1024;
    if (bytes.length > maxBytes) {
      throw new Error(
        `Downloaded payload exceeds policy max ${maxBytes} bytes (${attachmentPolicy.maxSizeMB} MB).`,
      );
    }

    const detectedMime = detectMimeFromMagic(bytes);
    if (detectedMime && !attachmentPolicy.allowedMimeTypes.includes(detectedMime)) {
      throw new Error(`Detected MIME type ${detectedMime} is blocked by policy.`);
    }

    return JSON.stringify(
      {
        messageId,
        attachmentId,
        filename: attachment.filename,
        mimeType: detectedMime ?? attachment.mimeType,
        size: bytes.length,
        data: encoded,
        policy: {
          allowed: true,
          detectedMime,
          policyVersion: attachmentPolicy.version,
        },
      },
      null,
      2,
    );
  }

  throw new Error(`Unknown attachment tool: ${name}`);
}