import { getGmailClient } from '../gmail/client.js';

export const metaToolDefinitions = [
  {
    name: 'get_labels',
    description:
      'List all Gmail labels (system labels like INBOX, SENT and user-created labels). Returns label IDs, names, and message counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_profile',
    description:
      'Get the authenticated Gmail user profile: email address, total message count, and thread count. Useful to verify the connection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleMetaTool(
  name: string,
  _args: Record<string, unknown>,
): Promise<string> {
  const gmail = await getGmailClient();

  if (name === 'get_labels') {
    const res = await gmail.users.labels.list({ userId: 'me' });
    const labels = (res.data.labels ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      messagesTotal: l.messagesTotal,
      messagesUnread: l.messagesUnread,
    }));
    return JSON.stringify(labels, null, 2);
  }

  if (name === 'get_profile') {
    const res = await gmail.users.getProfile({ userId: 'me' });
    return JSON.stringify(
      {
        emailAddress: res.data.emailAddress,
        messagesTotal: res.data.messagesTotal,
        threadsTotal: res.data.threadsTotal,
        historyId: res.data.historyId,
      },
      null,
      2,
    );
  }

  throw new Error(`Unknown meta tool: ${name}`);
}
