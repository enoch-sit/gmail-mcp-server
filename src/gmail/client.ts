import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { getAuthenticatedClient } from './auth.js';

let gmailInstance: gmail_v1.Gmail | null = null;

/**
 * Returns a singleton Gmail API client.
 * Call resetGmailClient() to force re-authentication (e.g. after saving new credentials).
 */
export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  if (gmailInstance) return gmailInstance;
  const auth = await getAuthenticatedClient();
  gmailInstance = google.gmail({ version: 'v1', auth });
  return gmailInstance;
}

/**
 * Clears the cached Gmail client, forcing re-authentication on next call.
 * Use this after credentials or tokens have been updated.
 */
export function resetGmailClient(): void {
  gmailInstance = null;
}
