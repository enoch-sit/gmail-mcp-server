# Gmail MCP Server

A comprehensive **Model Context Protocol (MCP) server** for Gmail, with 17 tools, an interactive CLI setup wizard, a browser-based Web UI wizard, and full Docker support.

---

## Features

| Tool | Description |
|---|---|
| `list_emails` | List emails from inbox or any label with optional query filter |
| `read_email` | Read full email content (headers + decoded body) |
| `search_emails` | Search using Gmail query syntax |
| `list_attachments_with_safety` | List message attachments with policy-based safety checks |
| `validate_attachment` | Validate one attachment against local file safety policy |
| `download_attachment_safe` | Download attachment only if it passes safety policy checks |
| `redact_text_local` | Redact sensitive text through local privacy pipeline |
| `read_email_with_privacy` | Read one email with privacy-redacted subject/snippet/body |
| `send_email` | Send plain-text or HTML emails |
| `create_draft` | Create email drafts without sending |
| `reply_to_email` | Reply to an email thread (preserves threading headers) |
| `delete_email` | Trash or permanently delete an email |
| `mark_as_read` | Mark email as read |
| `mark_as_unread` | Mark email as unread |
| `set_labels` | Add/remove labels on an email |
| `get_labels` | List all Gmail labels with message counts |
| `get_profile` | Get authenticated user profile info |

Attachment safety policy defaults are defined in `src/config/attachment-policy.json`.
Privacy policy defaults are defined in `src/config/privacy-policy.json`.

Optional local privacy stack (vLLM + privacy orchestrator) can be started with Docker profiles:

```bash
docker compose --profile privacy up --build
```

The privacy profile also enables optional persistent services:
- **Redis** (`redis:6379`) — token store for session-aware PII re-identification (future feature)
- **SQLite** (`audit.db`) — audit log of all PII detections and redactions for compliance

See [ARCHITECTURE.md](ARCHITECTURE.md#persistent-data-layer-optional) for database design details.

---

## Prerequisites

- **Node.js 20+** (for local setup)
- **Docker** (for containerised setup)
- A **Google Cloud project** with Gmail API enabled and an OAuth2 Client ID (Desktop app type)

### Google Cloud Setup (one-time)

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Create or select a project
3. **APIs & Services → Library** → search "Gmail API" → **Enable**
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Desktop app**
   - Add Authorized redirect URIs:
     - `http://localhost:3333/oauth/callback` ← for CLI wizard
     - `http://localhost:3000/oauth/callback` ← for Web UI wizard
5. Note your **Client ID** and **Client Secret** (or download `credentials.json`)

---

## Quick Start

### Option A — CLI Wizard (recommended for developers)

```bash
# 1. Install dependencies and build
npm install
npm run build

# 2. Run the interactive CLI setup wizard
npm run setup:cli

# 3. Start the MCP server
npm start
```

The CLI wizard will:
- Guide you through credential input (file / paste JSON / manual entry)
- Let you choose Gmail permission scopes
- Open your browser for Google sign-in
- Automatically capture the OAuth callback and save tokens
- Validate the connection and print your email + next steps

---

### Option B — Web UI Wizard (browser-based)

```bash
# 1. Install dependencies and build
npm install
npm run build

# 2. Start the setup wizard UI
npm run setup:ui

# 3. Open http://localhost:3000 in your browser
#    Complete the 4-step wizard, then start the server:
npm start
```

The Web UI provides a guided 4-step flow:
1. Enter OAuth2 credentials
2. Select permission scopes
3. Click **Authorize Gmail Access** → completes Google sign-in flow
4. Success page with connection stats and next steps

---

### Option C — Manual `.env` (CI / Docker production)

```bash
# Copy and fill in the template
cp .env.example .env
# Edit .env: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN

npm install
npm run build
npm start
```

---

## Docker

### Build the image

```bash
docker build -t gmail-mcp-server .
```

### Run the MCP server (with env vars)

```bash
# Copy .env.example → .env and fill in credentials
cp .env.example .env

docker compose up
```

Or pass credentials inline:

```bash
docker run -i \
  -e GMAIL_CLIENT_ID=your-client-id \
  -e GMAIL_CLIENT_SECRET=your-secret \
  -e GMAIL_REFRESH_TOKEN=your-refresh-token \
  gmail-mcp-server
```

### Run the Web UI Setup Wizard via Docker

```bash
docker compose -f docker-compose.setup.yml up
```

Then open [http://localhost:3000](http://localhost:3000) — credentials are written back to `./credentials/` on the host via volume mount.

### Mount credentials files instead of env vars

```bash
docker run -i \
  -v ./credentials:/app/credentials:ro \
  gmail-mcp-server
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GMAIL_CLIENT_ID` | Yes* | Google OAuth2 Client ID |
| `GMAIL_CLIENT_SECRET` | Yes* | Google OAuth2 Client Secret |
| `GMAIL_REFRESH_TOKEN` | Yes* | Long-lived refresh token (from setup wizard) |
| `GMAIL_REDIRECT_URI` | No | Override redirect URI (default: `http://localhost:3000/oauth/callback`) |
| `PORT` | No | Web UI setup server port (default: `3000`) |

\* Required when using env vars. Alternatively, use `credentials/credentials.json` + `credentials/token.json` (written by the setup wizards).

---

## Add to MCP Client (e.g. Claude Desktop)

Edit your MCP client config:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/gmail-mcp-server/dist/index.js"]
    }
  }
}
```

Or use Docker:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GMAIL_CLIENT_ID=...",
        "-e", "GMAIL_CLIENT_SECRET=...",
        "-e", "GMAIL_REFRESH_TOKEN=...",
        "gmail-mcp-server"
      ]
    }
  }
}
```

---

## Project Structure

```
├── src/
│   ├── index.ts                  # MCP server entry point
│   ├── gmail/
│   │   ├── auth.ts               # OAuth2 credential + token management
│   │   └── client.ts             # Gmail API client factory (singleton)
│   ├── tools/
│   │   ├── emails.ts             # list_emails, read_email, search_emails
│   │   ├── compose.ts            # send_email, create_draft, reply_to_email
│   │   ├── manage.ts             # delete_email, mark_as_read/unread, set_labels
│   │   └── meta.ts               # get_labels, get_profile
│   └── setup/
│       ├── oauth.ts              # Shared OAuth2 URL generation + token exchange
│       ├── cli.ts                # Interactive CLI setup wizard
│       └── ui-server.ts          # Express Web UI setup server
├── public/
│   └── setup/
│       └── index.html            # 4-step Web UI wizard (vanilla HTML/CSS/JS)
├── credentials/                  # Runtime secrets — gitignored
│   └── .gitkeep
├── Dockerfile                    # Multi-stage build (build + runtime)
├── docker-compose.yml            # MCP server runtime
├── docker-compose.setup.yml      # Web UI setup wizard runtime
├── .env.example                  # Environment variable template
└── tsconfig.json
```

---

## Security Notes

- `credentials/` is gitignored — **never** commit `credentials.json` or `token.json`
- Credentials are **not baked into the Docker image** — always injected via env vars or volume mounts
- The Web UI server and CLI callback server bind to `127.0.0.1` only (not publicly accessible)
- The runtime Docker container runs as a non-root user (`mcp`)

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `No Gmail credentials found` | Run `npm run setup:cli` or `npm run setup:ui` |
| `No Gmail token found` | Re-run the setup wizard to re-authorize |
| `invalid_client` from Google | Check that Client ID and Secret are correct |
| `redirect_uri_mismatch` | Ensure the redirect URI is added in Google Cloud Console exactly as shown in the wizard |
| `Port 3333 in use` | Kill the process using port 3333, or temporarily change `CLI_PORT` in `src/setup/cli.ts` |
| Token expired / `invalid_grant` | Re-run the setup wizard to get a fresh refresh token |
| Docker: `credentials not found` | Mount `./credentials:/app/credentials` or set env vars |
