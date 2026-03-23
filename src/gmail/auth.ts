import { google } from 'googleapis';
import type { Credentials } from 'google-auth-library';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';

const CREDENTIALS_DIR = path.join(process.cwd(), 'credentials');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
const TOKEN_FILE = path.join(CREDENTIALS_DIR, 'token.json');

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Re-export the google-auth-library type so consumers don't need to import it directly
export type GmailToken = Credentials;

async function ensureCredentialsDir(): Promise<void> {
  await fs.mkdir(CREDENTIALS_DIR, { recursive: true });
}

/**
 * Load OAuth2 client credentials.
 * Priority: environment variables > credentials/credentials.json file.
 */
export async function loadCredentials(): Promise<GmailCredentials> {
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return {
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      redirectUri:
        process.env.GMAIL_REDIRECT_URI ?? 'http://localhost:3000/oauth/callback',
    };
  }

  try {
    const raw = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
    const json = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const creds = (json['installed'] ?? json['web']) as Record<string, unknown> | undefined;
    if (!creds) {
      throw new Error('Invalid credentials.json: missing "installed" or "web" key.');
    }
    return {
      clientId: creds['client_id'] as string,
      clientSecret: creds['client_secret'] as string,
      redirectUri:
        (creds['redirect_uris'] as string[] | undefined)?.[0] ??
        'http://localhost:3000/oauth/callback',
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'No Gmail credentials found. Run `npm run setup:cli` or `npm run setup:ui` to configure.',
      );
    }
    throw err;
  }
}

/**
 * Persist client credentials to credentials/credentials.json.
 */
export async function saveCredentials(creds: GmailCredentials): Promise<void> {
  await ensureCredentialsDir();
  const credJson = {
    installed: {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      redirect_uris: [creds.redirectUri],
    },
  };
  await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(credJson, null, 2), 'utf-8');
}

/**
 * Load OAuth2 token.
 * Priority: GMAIL_REFRESH_TOKEN env var > credentials/token.json file.
 */
export async function loadToken(): Promise<GmailToken | null> {
  if (process.env.GMAIL_REFRESH_TOKEN) {
    return { refresh_token: process.env.GMAIL_REFRESH_TOKEN };
  }

  try {
    const raw = await fs.readFile(TOKEN_FILE, 'utf-8');
    return JSON.parse(raw) as GmailToken;
  } catch {
    return null;
  }
}

/**
 * Persist OAuth2 token to credentials/token.json.
 */
export async function saveToken(token: GmailToken): Promise<void> {
  await ensureCredentialsDir();
  await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf-8');
}

/**
 * Create a bare OAuth2 client using stored (or env) credentials.
 * Pass redirectUriOverride to use a different redirect URI than what's stored.
 */
export async function createOAuth2Client(redirectUriOverride?: string): Promise<OAuth2Client> {
  const creds = await loadCredentials();
  return new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    redirectUriOverride ?? creds.redirectUri,
  );
}

/**
 * Create an OAuth2 client that is already authenticated with the stored token.
 * Automatically persists refreshed tokens to disk (unless using env var token).
 */
export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const oauth2Client = await createOAuth2Client();
  const token = await loadToken();

  if (!token) {
    throw new Error(
      'No Gmail token found. Run `npm run setup:cli` or `npm run setup:ui` to authorize.',
    );
  }

  oauth2Client.setCredentials(token as Credentials);

  // Persist refreshed tokens automatically unless using env-var-supplied token
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    oauth2Client.on('tokens', async (newTokens) => {
      const existing = (await loadToken()) ?? {};
      await saveToken({ ...existing, ...newTokens });
    });
  }

  return oauth2Client;
}
