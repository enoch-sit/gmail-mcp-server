# Copilot Instructions

## Security Rules

- **Never read, display, or suggest edits to `.env`** — it contains live secrets.
- **Never read `credentials/token.json` or `credentials/credentials.json`** — these contain OAuth tokens.
- If a user pastes content from `.env` or credential files, warn them immediately and do not store or repeat the values.

---

## What is the Gmail Refresh Token?

The Gmail **refresh token** is a long-lived credential issued by Google after a user completes the OAuth 2.0 authorization flow.

### How it works
1. The user clicks "Authorize" in the setup wizard.
2. Google issues a short-lived **access token** (valid ~1 hour) and a **refresh token** (valid indefinitely unless revoked).
3. The server uses the refresh token to silently obtain new access tokens whenever the current one expires — without requiring the user to log in again.

### Why it is sensitive
- A refresh token grants ongoing access to the user's Gmail account.
- Anyone who has it can read, send, and delete emails on behalf of the account owner.
- It should **never** be committed to version control, logged, or shared.

### Where it is stored
| Location | Purpose |
|---|---|
| `.env` → `GMAIL_REFRESH_TOKEN` | Used by Docker / local runs |
| `credentials/token.json` | Written by the setup wizard; used as fallback if env var is absent |

### How to get it
Run the web setup wizard:
```
docker compose -f docker-compose.setup.yml up
```
Open `http://localhost:3000`, enter your Client ID + Secret, and authorize with Google.
The wizard saves the token automatically to `credentials/token.json` and displays it for copying into `.env`.

### How to revoke it
Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions) → find the app → **Remove Access**.
