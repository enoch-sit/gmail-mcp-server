import { getGmailClient } from '../gmail/client.js';

export const manageToolDefinitions = [
  {
    name: 'delete_email',
    description:
      'Move an email to Trash. Pass permanent: true to permanently delete (irreversible).',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
        permanent: {
          type: 'boolean',
          description: 'If true, permanently delete the email (default: false — moves to Trash)',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mark_as_read',
    description: 'Mark an email as read by removing the UNREAD label.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'mark_as_unread',
    description: 'Mark an email as unread by adding the UNREAD label.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'set_labels',
    description:
      'Add and/or remove labels on an email. Use get_labels to obtain valid label IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
        addLabelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label IDs to add (e.g. ["Label_123", "STARRED"])',
        },
        removeLabelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label IDs to remove (e.g. ["INBOX", "UNREAD"])',
        },
      },
      required: ['messageId'],
    },
  },
];

export async function handleManageTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const gmail = await getGmailClient();

  if (name === 'delete_email') {
    const { messageId, permanent = false } = args as {
      messageId: string;
      permanent?: boolean;
    };

    if (permanent) {
      await gmail.users.messages.delete({ userId: 'me', id: messageId });
      return JSON.stringify({ success: true, action: 'permanently_deleted', messageId }, null, 2);
    }

    await gmail.users.messages.trash({ userId: 'me', id: messageId });
    return JSON.stringify({ success: true, action: 'moved_to_trash', messageId }, null, 2);
  }

  if (name === 'mark_as_read') {
    const { messageId } = args as { messageId: string };
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
    return JSON.stringify({ success: true, action: 'marked_as_read', messageId }, null, 2);
  }

  if (name === 'mark_as_unread') {
    const { messageId } = args as { messageId: string };
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: ['UNREAD'] },
    });
    return JSON.stringify({ success: true, action: 'marked_as_unread', messageId }, null, 2);
  }

  if (name === 'set_labels') {
    const {
      messageId,
      addLabelIds = [],
      removeLabelIds = [],
    } = args as {
      messageId: string;
      addLabelIds?: string[];
      removeLabelIds?: string[];
    };

    const res = await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds, removeLabelIds },
    });

    return JSON.stringify(
      {
        success: true,
        messageId,
        currentLabelIds: res.data.labelIds ?? [],
        added: addLabelIds,
        removed: removeLabelIds,
      },
      null,
      2,
    );
  }

  throw new Error(`Unknown manage tool: ${name}`);
}
