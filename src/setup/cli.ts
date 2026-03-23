#!/usr/bin/env node
import 'dotenv/config';
import * as p from '@clack/prompts';
import open from 'open';
import http from 'http';
import fs from 'fs/promises';
import { existsSync } from 'fs';

import {
  saveCredentials,
  saveToken,
  GMAIL_SCOPES,
  type GmailCredentials,
} from '../gmail/auth.js';
import { generateAuthUrl } from './oauth.js';
import { resetGmailClient, getGmailClient } from '../gmail/client.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CLI_PORT = 3333;
const CLI_REDIRECT_URI = `http://localhost:${CLI_PORT}/oauth/callback`;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Spin up a temporary local HTTP server, wait for Google to redirect back with
 * an authorization code, then shut the server down.
 */
function waitForOAuthCallback(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        const html = (title: string, body: string) =>
          `<!DOCTYPE html><html><head><title>${title}</title>
           <style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;text-align:center}
           h2{margin-bottom:8px}p{color:#555}</style></head>
           <body><h2>${title}</h2><p>${body}</p></body></html>`;

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            html('Authentication failed', `Error: <strong>${error}</strong><br>You can close this window.`),
          );
          server.close();
          reject(new Error(`Google OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            html(
              '✅ Authenticated!',
              'Authorization successful. You can close this window and return to the terminal.',
            ),
          );
          server.close();
          resolve(code);
        }
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.listen(port, '127.0.0.1', () => {});

    server.on('error', (err) =>
      reject(
        new Error(
          `Could not start callback server on port ${port}: ${(err as Error).message}\n` +
            'Is another process using it? Try killing it or change CLI_PORT in cli.ts.',
        ),
      ),
    );

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth authorization timed out after 5 minutes.'));
    }, AUTH_TIMEOUT_MS);
  });
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  p.intro(' 🔐  Gmail MCP Server — CLI Setup Wizard ');

  p.note(
    [
      'This wizard will:',
      '  1. Collect your Google OAuth2 credentials',
      '  2. Let you choose Gmail permission scopes',
      '  3. Open your browser for Google authorization',
      '  4. Save tokens and validate the connection',
    ].join('\n'),
    'What to expect',
  );

  // ── Step 0: Prerequisites ──────────────────────────────────────────────────

  const prereqOk = await p.confirm({
    message: [
      'Before continuing, make sure you have:',
      '  ✓  A Google Cloud project (console.cloud.google.com)',
      '  ✓  Gmail API enabled  (APIs & Services → Library)',
      '  ✓  OAuth 2.0 Client ID created  (type: Desktop app)',
      `  ✓  Redirect URI added: ${CLI_REDIRECT_URI}`,
      '',
      'Ready to proceed?',
    ].join('\n'),
  });

  if (p.isCancel(prereqOk) || !prereqOk) {
    p.note(
      [
        '1. Visit https://console.cloud.google.com/',
        '2. Create or select a project',
        '3. APIs & Services → Library → "Gmail API" → Enable',
        '4. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID',
        '5. Application type: Desktop app',
        `6. Authorized redirect URIs → Add: ${CLI_REDIRECT_URI}`,
        '7. Download the JSON or copy Client ID & Client Secret',
        '8. Re-run: npm run setup:cli',
      ].join('\n'),
      'Setup Instructions',
    );
    p.outro('Wizard cancelled. Run npm run setup:cli when ready.');
    process.exit(0);
  }

  // ── Step 1: Credential input ───────────────────────────────────────────────

  const inputMethod = await p.select({
    message: 'How would you like to provide your OAuth2 credentials?',
    options: [
      {
        value: 'file',
        label: 'Load from credentials.json',
        hint: 'File downloaded from Google Cloud Console',
      },
      {
        value: 'json',
        label: 'Paste JSON content',
        hint: 'Paste the full JSON from Google Cloud Console',
      },
      {
        value: 'manual',
        label: 'Enter Client ID and Secret manually',
        hint: 'Type or paste individual values',
      },
    ],
  });

  if (p.isCancel(inputMethod)) {
    p.outro('Setup cancelled.');
    process.exit(0);
  }

  let credentials: GmailCredentials;

  if (inputMethod === 'file') {
    const filePath = await p.text({
      message: 'Path to credentials.json:',
      placeholder: './credentials.json',
      defaultValue: './credentials.json',
      validate: (v) => {
        if (!existsSync(v)) return `File not found: ${v}`;
        return undefined;
      },
    });
    if (p.isCancel(filePath)) {
      p.outro('Setup cancelled.');
      process.exit(0);
    }

    const raw = await fs.readFile(filePath as string, 'utf-8');
    const json = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const creds = (json['installed'] ?? json['web']) as Record<string, unknown>;
    if (!creds?.['client_id'] || !creds?.['client_secret']) {
      p.outro('Invalid credentials.json: missing client_id or client_secret.');
      process.exit(1);
    }
    credentials = {
      clientId: creds['client_id'] as string,
      clientSecret: creds['client_secret'] as string,
      redirectUri: CLI_REDIRECT_URI,
    };
  } else if (inputMethod === 'json') {
    const jsonContent = await p.text({
      message: 'Paste credentials JSON:',
      placeholder: '{"installed":{"client_id":"...","client_secret":"...",...}}',
      validate: (v) => {
        try {
          const j = JSON.parse(v) as Record<string, Record<string, unknown>>;
          const c = j['installed'] ?? j['web'];
          if (!c?.['client_id'] || !c?.['client_secret']) {
            return 'JSON must contain client_id and client_secret';
          }
        } catch {
          return 'Invalid JSON';
        }
        return undefined;
      },
    });
    if (p.isCancel(jsonContent)) {
      p.outro('Setup cancelled.');
      process.exit(0);
    }
    const json = JSON.parse(jsonContent as string) as Record<string, Record<string, unknown>>;
    const creds = (json['installed'] ?? json['web']) as Record<string, unknown>;
    credentials = {
      clientId: creds['client_id'] as string,
      clientSecret: creds['client_secret'] as string,
      redirectUri: CLI_REDIRECT_URI,
    };
  } else {
    const clientId = await p.text({
      message: 'Client ID:',
      placeholder: 'xxxxxxxxxxxx-xxxx.apps.googleusercontent.com',
      validate: (v) => (v.trim() ? undefined : 'Client ID is required'),
    });
    if (p.isCancel(clientId)) {
      p.outro('Setup cancelled.');
      process.exit(0);
    }

    const clientSecret = await p.password({
      message: 'Client Secret:',
      validate: (v) => (v.trim() ? undefined : 'Client Secret is required'),
    });
    if (p.isCancel(clientSecret)) {
      p.outro('Setup cancelled.');
      process.exit(0);
    }

    credentials = {
      clientId: (clientId as string).trim(),
      clientSecret: (clientSecret as string).trim(),
      redirectUri: CLI_REDIRECT_URI,
    };
  }

  // ── Step 2: Scope selection ────────────────────────────────────────────────

  const scopeLevel = await p.select({
    message: 'Select Gmail permission level:',
    options: [
      {
        value: 'readonly',
        label: 'Read-only',
        hint: 'List, read, and search emails only',
      },
      {
        value: 'send',
        label: 'Read + Send',
        hint: 'Read emails and send new ones',
      },
      {
        value: 'full',
        label: 'Full access  (recommended)',
        hint: 'Read, send, modify labels, delete, manage drafts',
      },
    ],
    initialValue: 'full',
  });

  if (p.isCancel(scopeLevel)) {
    p.outro('Setup cancelled.');
    process.exit(0);
  }

  const scopeMap: Record<string, string[]> = {
    readonly: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    send: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    full: GMAIL_SCOPES,
  };

  const selectedScopes = scopeMap[scopeLevel as string];

  // ── Step 3: Save credentials ───────────────────────────────────────────────

  const saveSpinner = p.spinner();
  saveSpinner.start('Saving credentials…');
  await saveCredentials(credentials);
  saveSpinner.stop('Credentials saved to credentials/credentials.json');

  // ── Step 4: OAuth2 browser flow ────────────────────────────────────────────

  const { url, client } = await generateAuthUrl({
    scopes: selectedScopes,
    redirectUri: CLI_REDIRECT_URI,
  });

  p.note(
    [
      'Your browser will open with the Google sign-in page.',
      'Sign in, grant the requested permissions, and the',
      'wizard will automatically receive the authorization code.',
      '',
      `If your browser does not open, copy this URL manually:`,
      url,
    ].join('\n'),
    'OAuth2 Authorization',
  );

  try {
    await open(url);
  } catch {
    // Browser open failed — user will use the URL shown above
  }

  const authSpinner = p.spinner();
  authSpinner.start(`Waiting for authorization on port ${CLI_PORT}… (5 min timeout)`);

  let authCode: string;
  try {
    authCode = await waitForOAuthCallback(CLI_PORT);
  } catch (err) {
    authSpinner.stop('Authorization failed.');
    p.outro(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  authSpinner.stop('Authorization code received!');

  // ── Step 5: Exchange code for tokens ──────────────────────────────────────

  const tokenSpinner = p.spinner();
  tokenSpinner.start('Exchanging code for tokens…');

  try {
    const { tokens } = await client.getToken(authCode);
    client.setCredentials(tokens);
    await saveToken(tokens);
    tokenSpinner.stop('Tokens saved to credentials/token.json');
  } catch (err) {
    tokenSpinner.stop('Token exchange failed.');
    p.outro(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // ── Step 6: Validate connection ────────────────────────────────────────────

  const validateSpinner = p.spinner();
  validateSpinner.start('Validating Gmail connection…');

  try {
    resetGmailClient();
    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    validateSpinner.stop(`Connected as: ${profile.data.emailAddress}`);

    p.note(
      [
        `✅  Authenticated as: ${profile.data.emailAddress}`,
        `📧  Total messages:   ${profile.data.messagesTotal}`,
        `🧵  Total threads:    ${profile.data.threadsTotal}`,
        '',
        'Next steps:',
        '  Run MCP server locally:  npm start',
        '  Run with Docker:         docker compose up',
        '',
        'Add to your MCP client config (e.g. Claude Desktop):',
        '  {',
        '    "mcpServers": {',
        '      "gmail": {',
        '        "command": "node",',
        '        "args": ["<absolute-path-to>/dist/index.js"]',
        '      }',
        '    }',
        '  }',
      ].join('\n'),
      'Setup Complete!',
    );
  } catch (err) {
    validateSpinner.stop('Connection validation failed.');
    p.outro(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  p.outro('🎉  Gmail MCP Server is ready!');
}

main().catch((err: Error) => {
  process.stderr.write(`Setup error: ${err.message}\n`);
  process.exit(1);
});
