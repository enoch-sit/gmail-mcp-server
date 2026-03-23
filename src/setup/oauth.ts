import type { OAuth2Client } from 'google-auth-library';
import { createOAuth2Client, saveToken, GMAIL_SCOPES } from '../gmail/auth.js';

export interface AuthUrlOptions {
  scopes?: string[];
  /** Override the redirect URI stored in credentials (useful for CLI vs UI flows). */
  redirectUri?: string;
}

/**
 * Generate a Google OAuth2 authorization URL.
 * Returns the URL and the OAuth2 client (needed to exchange the code later).
 */
export async function generateAuthUrl(
  options: AuthUrlOptions = {},
): Promise<{ url: string; client: OAuth2Client }> {
  const client = await createOAuth2Client(options.redirectUri);
  const scopes = options.scopes ?? GMAIL_SCOPES;

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  return { url, client };
}

/**
 * Exchange an authorization code for tokens and persist them to disk.
 */
export async function exchangeCodeForTokens(
  client: OAuth2Client,
  code: string,
): Promise<void> {
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await saveToken(tokens);
}
