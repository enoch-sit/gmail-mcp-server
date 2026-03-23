#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OAuth2Client } from 'google-auth-library';

import { saveCredentials } from '../gmail/auth.js';
import { generateAuthUrl, exchangeCodeForTokens } from './oauth.js';
import { resetGmailClient, getGmailClient } from '../gmail/client.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve public/setup relative to the project root (two levels up from dist/setup/)
const PUBLIC_DIR = path.resolve(__dirname, '../../public/setup');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const UI_REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

// ─── State ────────────────────────────────────────────────────────────────────

let pendingOAuthClient: OAuth2Client | null = null;
let pendingScopes: string[] = [];

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── POST /api/save-config  →  Step 1: Save OAuth2 client credentials ──────────
app.post('/api/save-config', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body as {
      clientId?: string;
      clientSecret?: string;
    };

    if (!clientId?.trim() || !clientSecret?.trim()) {
      res.status(400).json({ error: 'clientId and clientSecret are required.' });
      return;
    }

    await saveCredentials({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri: UI_REDIRECT_URI,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /api/set-scopes  →  Step 2: Choose permission scopes ─────────────────
app.post('/api/set-scopes', (req, res) => {
  const { scopes } = req.body as { scopes?: string[] };

  if (!Array.isArray(scopes) || scopes.length === 0) {
    res.status(400).json({ error: 'scopes must be a non-empty array.' });
    return;
  }

  pendingScopes = scopes;
  res.json({ success: true, scopes });
});

// ── GET /api/auth-url  →  Step 3: Get the Google authorization URL ─────────────
app.get('/api/auth-url', async (req, res) => {
  try {
    const { url, client } = await generateAuthUrl({
      scopes: pendingScopes.length > 0 ? pendingScopes : undefined,
      redirectUri: UI_REDIRECT_URI,
    });
    pendingOAuthClient = client;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /oauth/callback  →  Google redirects here after authorization ──────────
app.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error) {
    res.redirect(`/?error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !pendingOAuthClient) {
    res.redirect('/?error=missing_code_or_client');
    return;
  }

  try {
    await exchangeCodeForTokens(pendingOAuthClient, code);
    pendingOAuthClient = null;

    resetGmailClient();
    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: 'me' });

    res.redirect(
      `/?success=true&email=${encodeURIComponent(profile.data.emailAddress ?? '')}` +
        `&messages=${profile.data.messagesTotal ?? 0}` +
        `&threads=${profile.data.threadsTotal ?? 0}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(`/?error=${encodeURIComponent(msg)}`);
  }
});

// ── GET /api/status  →  Check if already authenticated ────────────────────────
app.get('/api/status', async (_req, res) => {
  try {
    resetGmailClient();
    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    res.json({
      authenticated: true,
      emailAddress: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
    });
  } catch {
    res.json({ authenticated: false });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log('\n──────────────────────────────────────────');
  console.log(' 🌐  Gmail MCP Server — Web Setup Wizard');
  console.log('──────────────────────────────────────────');
  console.log(`\n  Open in your browser: http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop.\n');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
