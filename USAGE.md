# Gmail MCP Server — Usage Guide

A step-by-step guide to setting up, connecting, and using the Gmail MCP server —
plus a complete [CrewAI](#crewai-example) example that shows how to build an
autonomous email-triage crew with it.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Google Cloud Setup (one-time)](#2-google-cloud-setup-one-time)
3. [Build & Authorize](#3-build--authorize)
4. [Connect Your MCP Client](#4-connect-your-mcp-client)
5. [Tool Reference](#5-tool-reference)
6. [Gmail Query Syntax Tips](#6-gmail-query-syntax-tips)
7. [CrewAI Example — Daily Email Triage Crew](#7-crewai-example--daily-email-triage-crew)

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** | `node --version` to check |
| **npm ≥ 9** | Comes with Node |
| **Google account** | The account whose Gmail you want to access |
| **Google Cloud project** | Free tier is fine |
| **Docker** *(optional)* | Only needed for the Docker setup path |
| **Python ≥ 3.10** | Only needed for the CrewAI example |

---

## 2. Google Cloud Setup (one-time)

> Skip this section if you already have a `credentials.json` or your `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`.

1. Go to **[https://console.cloud.google.com](https://console.cloud.google.com)** and select (or create) a project.
2. Navigate to **APIs & Services → Library**, search for **"Gmail API"**, and click **Enable**.
3. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
   - Application type: **Desktop app**
   - Give it any name (e.g. `gmail-mcp`)
4. Under **Authorized redirect URIs**, add **both**:
   - `http://localhost:3333/oauth/callback` ← CLI wizard
   - `http://localhost:3000/oauth/callback` ← Web UI wizard
5. Click **Create**. Note (or download) your **Client ID** and **Client Secret**.

> **Scopes used**: `gmail.modify`, `userinfo.profile`, `userinfo.email`

---

## 3. Build & Authorize

### Option A — CLI Wizard (recommended for developers)

```bash
# 1. Install dependencies and compile TypeScript
npm install
npm run build

# 2. Run the interactive setup wizard
npm run setup:cli
```

The wizard will:
- Ask how you want to provide credentials (file / paste JSON / manual entry)
- Open your browser for Google sign-in
- Automatically capture the OAuth callback
- Save your tokens to `credentials/token.json`
- Print your email address and confirm the connection is working

```bash
# 3. Start the MCP server
npm start
# → "Gmail MCP Server running on stdio"
```

### Option B — Web UI Wizard (browser-based)

```bash
npm install && npm run build
npm run setup:ui
# Open http://localhost:3000 and complete the 4-step wizard
npm start
```

### Option C — Environment Variables (CI / Docker / programmatic)

```bash
# Copy the template and fill in the three required values
cp .env.example .env
```

```dotenv
# .env
GMAIL_CLIENT_ID=your-google-client-id
GMAIL_CLIENT_SECRET=your-google-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token   # obtained from the setup wizard
```

```bash
npm install && npm run build
npm start
```

> **How to obtain the refresh token without the file wizard**:
> Run the Web UI wizard once via Docker, then copy the token it displays.
>
> ```bash
> docker compose -f docker-compose.setup.yml up
> # Open http://localhost:3000, complete the wizard, copy the displayed token
> ```

---

## 4. Connect Your MCP Client

The server speaks **MCP over stdio** — it has no HTTP port. Any MCP-compatible
client (Claude Desktop, Cursor, Windsurf, Continue.dev …) can connect with a
small config snippet.

### Claude Desktop / Cursor

Edit `~/.config/Claude/claude_desktop_config.json` (Mac/Linux) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["C:/absolute/path/to/ThankGodForGmailMCPServers/dist/index.js"],
      "env": {
        "GMAIL_CLIENT_ID": "your-client-id",
        "GMAIL_CLIENT_SECRET": "your-client-secret",
        "GMAIL_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

> If you used the setup wizard with `credentials/token.json`, you can omit the
> `env` block — the server will read credentials from the file automatically.

### Docker variant

```json
{
  "mcpServers": {
    "gmail": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GMAIL_CLIENT_ID=your-client-id",
        "-e", "GMAIL_CLIENT_SECRET=your-client-secret",
        "-e", "GMAIL_REFRESH_TOKEN=your-refresh-token",
        "gmail-mcp-server"
      ]
    }
  }
}
```

### Verifying the connection

After restarting your MCP client, open a new conversation and ask:

> "Use the Gmail tool to tell me my email address and how many messages I have."

The client will invoke `get_profile` and display the result. If it works,
all 12 tools are ready.

---

## 5. Tool Reference

### Reading emails

| Tool | What it does | Key parameters |
|---|---|---|
| `list_emails` | List emails from inbox (or any label) | `labelIds` (default `["INBOX"]`), `query`, `maxResults` (default 10, max 50) |
| `read_email` | Fetch the full content of one email | `messageId` (required) |
| `search_emails` | Search using Gmail query syntax | `query` (required), `maxResults` |

### Composing emails

| Tool | What it does | Key parameters |
|---|---|---|
| `send_email` | Send a plain-text or HTML email immediately | `to`, `subject`, `body` (required); `cc`, `bcc`, `isHtml` |
| `create_draft` | Save an email as a draft (not sent) | `to`, `subject`, `body` (required); `cc`, `bcc`, `isHtml` |
| `reply_to_email` | Reply to an existing thread (threading headers preserved) | `messageId`, `body` (required); `isHtml` |

### Managing emails

| Tool | What it does | Key parameters |
|---|---|---|
| `delete_email` | Move to trash, or permanently delete | `messageId` (required); `permanent` (default `false`) |
| `mark_as_read` | Remove the `UNREAD` label | `messageId` (required) |
| `mark_as_unread` | Add the `UNREAD` label | `messageId` (required) |
| `set_labels` | Add and/or remove any label(s) in one call | `messageId` (required); `addLabelIds`, `removeLabelIds` |

### Account metadata

| Tool | What it does | Parameters |
|---|---|---|
| `get_labels` | List all Gmail labels (system + custom) with message counts | none |
| `get_profile` | Get your email address, total messages, thread count | none |

---

## 6. Gmail Query Syntax Tips

The `query` parameter in `list_emails` and `search_emails` accepts the same
syntax as the Gmail search box.

| Query | What it matches |
|---|---|
| `is:unread` | Unread messages |
| `is:starred` | Starred messages |
| `from:boss@company.com` | From a specific sender |
| `to:me` | Sent directly to you |
| `subject:invoice` | Subject contains "invoice" |
| `has:attachment` | Has one or more attachments |
| `label:Work` | Tagged with a custom label |
| `newer_than:1d` | Received in the last 24 hours |
| `older_than:7d` | Older than 7 days |
| `is:unread newer_than:1d` | Unread in the last 24 hours |
| `-label:CATEGORY_PROMOTIONS is:unread` | Unread and not in Promotions tab |

Full reference: [Gmail search operators](https://support.google.com/mail/answer/7190)

---

## 7. CrewAI Example — Daily Email Triage Crew

This example builds a two-agent crew that:

1. **EmailTriageAgent** — reads unread emails from the last 24 hours, scores
   their priority (Urgent / Action Required / FYI / Newsletter), and produces a
   structured triage report.
2. **EmailResponderAgent** — for every email marked *Action Required*, creates a
   polite draft reply in Gmail (no email is actually sent — safe for testing).

The agents connect to this Gmail MCP server via **stdio transport** using the
modern `MCPServerStdio` DSL introduced in CrewAI ≥ 0.100.

### Installing CrewAI dependencies

```bash
pip install "crewai>=0.100" "crewai-tools[mcp]" mcp
```

> **Need an older CrewAI?** See the
> [MCPServerAdapter variant](#alternative-mcpserveradapter) at the bottom of
> this section — it works with crewai-tools ≥ 0.14.

### Environment variables

The example reads credentials from environment variables only.
Set them before running:

```bash
# Linux / macOS
export GMAIL_CLIENT_ID="your-client-id"
export GMAIL_CLIENT_SECRET="your-client-secret"
export GMAIL_REFRESH_TOKEN="your-refresh-token"
export OPENAI_API_KEY="your-openai-key"   # or swap for another LLM — see below

# Windows PowerShell
$env:GMAIL_CLIENT_ID       = "your-client-id"
$env:GMAIL_CLIENT_SECRET   = "your-client-secret"
$env:GMAIL_REFRESH_TOKEN   = "your-refresh-token"
$env:OPENAI_API_KEY        = "your-openai-key"
```

> **Using a different LLM?** See [Configuring the LLM](#configuring-the-llm)
> below. The Gmail tools work with any LLM that supports function/tool calling.

### The script

```python
# examples/crewai_email_triage/triage_crew.py

import os
from pathlib import Path

from crewai import Agent, Crew, Process, Task
from crewai.mcp import MCPServerStdio

# ── 1. Locate the compiled MCP server ─────────────────────────────────────────
# Point this at the dist/index.js of THIS repository.
REPO_ROOT = Path(__file__).resolve().parents[2]   # adjust if you move the file
MCP_SERVER_PATH = REPO_ROOT / "dist" / "index.js"

if not MCP_SERVER_PATH.exists():
    raise FileNotFoundError(
        f"Gmail MCP server not built. Run `npm run build` first.\n"
        f"Expected: {MCP_SERVER_PATH}"
    )

# ── 2. Configure the Gmail MCP server (stdio transport) ───────────────────────
gmail_mcp = MCPServerStdio(
    command="node",
    args=[str(MCP_SERVER_PATH)],
    # Credentials are forwarded to the Node process via environment variables.
    # They are NEVER hardcoded — always pass them from your shell environment.
    env={
        "GMAIL_CLIENT_ID":     os.environ["GMAIL_CLIENT_ID"],
        "GMAIL_CLIENT_SECRET": os.environ["GMAIL_CLIENT_SECRET"],
        "GMAIL_REFRESH_TOKEN": os.environ["GMAIL_REFRESH_TOKEN"],
    },
    cache_tools_list=True,   # discover tools once and reuse — improves speed
)

# ── 3. Define the agents ───────────────────────────────────────────────────────

triage_agent = Agent(
    role="Email Triage Specialist",
    goal=(
        "Read every unread email that arrived in the last 24 hours and produce "
        "a structured triage report sorted by priority."
    ),
    backstory=(
        "You are a meticulous executive assistant who helps busy professionals "
        "cut through inbox noise. You categorise every email accurately and "
        "never miss an urgent message."
    ),
    mcps=[gmail_mcp],
    verbose=True,
)

responder_agent = Agent(
    role="Professional Email Writer",
    goal=(
        "Draft concise, professional replies for all emails marked "
        "'Action Required' in the triage report."
    ),
    backstory=(
        "You write clear, polite, and context-aware business emails. "
        "You always create drafts rather than sending directly — letting the "
        "human review before anything leaves the outbox."
    ),
    mcps=[gmail_mcp],
    verbose=True,
)

# ── 4. Define the tasks ────────────────────────────────────────────────────────

triage_task = Task(
    description=(
        "Use the Gmail tools to:\n"
        "1. Call `get_profile` to confirm the connected account.\n"
        "2. Call `search_emails` with query `is:unread newer_than:1d` to find "
        "   all unread emails from the last 24 hours (max 20).\n"
        "3. For each email, call `read_email` to get the full content.\n"
        "4. Categorise each email into exactly one of:\n"
        "   - **Urgent** — needs a response within the hour\n"
        "   - **Action Required** — needs a response today\n"
        "   - **FYI** — informational, no reply needed\n"
        "   - **Newsletter / Promo** — bulk / marketing email\n"
        "5. Return a Markdown table with columns: "
        "   Sender | Subject | Category | One-line Summary | Message ID"
    ),
    expected_output=(
        "A Markdown report with:\n"
        "- A header line: `Email Triage Report — <date> — <account email>`\n"
        "- A table with one row per email (columns: Sender, Subject, Category, "
        "  Summary, Message ID)\n"
        "- A brief stats line at the bottom: total count per category"
    ),
    agent=triage_agent,
)

reply_task = Task(
    description=(
        "Using the triage report from the previous task:\n"
        "1. Extract every email with category **Action Required**.\n"
        "2. For each one, call `read_email` again to get the full thread context.\n"
        "3. Call `create_draft` to create a polite, professional reply.\n"
        "   - Keep replies to 3–5 sentences.\n"
        "   - Acknowledge the sender's request and state a clear next step.\n"
        "   - Do NOT call `send_email` — drafts only.\n"
        "4. Return a summary of the drafts created."
    ),
    expected_output=(
        "A Markdown list of created drafts, each showing:\n"
        "- Original sender and subject\n"
        "- The draft reply text\n"
        "- Confirmation that `create_draft` succeeded"
    ),
    agent=responder_agent,
    context=[triage_task],   # responder sees the triage output
)

# ── 5. Assemble and run the crew ───────────────────────────────────────────────

crew = Crew(
    agents=[triage_agent, responder_agent],
    tasks=[triage_task, reply_task],
    process=Process.sequential,   # triage → reply (in order)
    verbose=True,
)

if __name__ == "__main__":
    print("Starting Daily Email Triage Crew...\n")
    result = crew.kickoff()
    print("\n" + "=" * 60)
    print("CREW RESULT")
    print("=" * 60)
    print(result)
```

### Running the crew

```bash
# From the repository root
python examples/crewai_email_triage/triage_crew.py
```

Expected output flow:

```
Starting Daily Email Triage Crew...

[EmailTriageAgent] Calling get_profile ...
[EmailTriageAgent] Calling search_emails (is:unread newer_than:1d) ...
[EmailTriageAgent] Calling read_email for message <id> ...
...
[EmailResponderAgent] Calling read_email for <Action Required message> ...
[EmailResponderAgent] Calling create_draft ...
...
============================================================
CREW RESULT
============================================================
## Drafts Created

- **Alice Chen** — "Q2 budget review needed"
  Draft: "Hi Alice, thank you for reaching out about the Q2 budget review ..."
  ✓ Draft created successfully
```

---

### Configuring the LLM

CrewAI defaults to OpenAI (`gpt-4o`). Pass an `llm=` argument to `Agent` to
override it.

**Anthropic Claude**

```python
from crewai import LLM

claude = LLM(model="claude-sonnet-4-5", api_key=os.environ["ANTHROPIC_API_KEY"])

triage_agent = Agent(..., llm=claude)
responder_agent = Agent(..., llm=claude)
```

**Google Gemini**

```python
gemini = LLM(model="gemini/gemini-1.5-pro", api_key=os.environ["GEMINI_API_KEY"])
```

**Local Ollama**

```python
ollama = LLM(model="ollama/llama3.1:8b", base_url="http://localhost:11434")
```

---

### Alternative: MCPServerAdapter

For CrewAI versions that pre-date the `mcps=[]` DSL, or when you need manual
lifecycle control, use `MCPServerAdapter` from `crewai-tools`:

```bash
pip install "crewai-tools[mcp]>=0.14" mcp
```

```python
import os
from pathlib import Path

from crewai import Agent, Crew, Process, Task
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_SERVER_PATH = REPO_ROOT / "dist" / "index.js"

server_params = StdioServerParameters(
    command="node",
    args=[str(MCP_SERVER_PATH)],
    env={
        "GMAIL_CLIENT_ID":     os.environ["GMAIL_CLIENT_ID"],
        "GMAIL_CLIENT_SECRET": os.environ["GMAIL_CLIENT_SECRET"],
        "GMAIL_REFRESH_TOKEN": os.environ["GMAIL_REFRESH_TOKEN"],
        **os.environ,         # pass through PATH so Node can find itself
    },
)

# The `with` block starts the Node process and stops it when the block exits.
with MCPServerAdapter(server_params, connect_timeout=60) as gmail_tools:
    print("Available Gmail tools:", [t.name for t in gmail_tools])

    triage_agent = Agent(
        role="Email Triage Specialist",
        goal="Triage unread emails from the last 24 hours.",
        backstory="Meticulous assistant who categorises inbox emails by priority.",
        tools=gmail_tools,    # pass the raw tool list here
        verbose=True,
    )

    responder_agent = Agent(
        role="Professional Email Writer",
        goal="Draft replies for Action Required emails.",
        backstory="Writes polite, concise business emails. Always creates drafts.",
        tools=gmail_tools,
        verbose=True,
    )

    # --- tasks (same descriptions as above, omitted for brevity) ---
    triage_task = Task(
        description=(
            "Search unread emails from the last 24 hours, read each one, "
            "and produce a triage table: Sender | Subject | Category | Summary | Message ID"
        ),
        expected_output="A Markdown triage table with a stats summary.",
        agent=triage_agent,
    )

    reply_task = Task(
        description=(
            "For each 'Action Required' email in the triage report, "
            "call create_draft to write a short professional reply. DO NOT send."
        ),
        expected_output="A list of created drafts with confirmation.",
        agent=responder_agent,
        context=[triage_task],
    )

    crew = Crew(
        agents=[triage_agent, responder_agent],
        tasks=[triage_task, reply_task],
        process=Process.sequential,
        verbose=True,
    )

    result = crew.kickoff()
    print(result)
```

---

### Extending the example

Here are a few ideas to build on this crew:

| Extension | How |
|---|---|
| **Auto-label by category** | After triage, call `set_labels` to apply `Urgent`, `Action-Required`, etc. |
| **Summarise newsletters** | Add a third agent that reads newsletter bodies and writes a digest |
| **Daily digest email** | After the crew runs, call `send_email` to send yourself the triage report |
| **Scheduled runs** | Wrap `crew.kickoff()` in a cron job or GitHub Actions workflow |
| **Slack notifications** | Pipe the result into a Slack MCP tool alongside Gmail |

---

## Need Help?

| Problem | Check |
|---|---|
| `FileNotFoundError: dist/index.js` | Run `npm run build` in the repo root |
| `No Gmail credentials found` | Run `npm run setup:cli` or set the three env vars |
| `invalid_client` from Google | Verify `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` |
| `redirect_uri_mismatch` | Add the redirect URI to Google Cloud Console |
| `MCPServerAdapter` import error | Upgrade: `pip install "crewai-tools[mcp]>=0.14"` |
| Agent calls wrong tool | Add `verbose=True` to see tool selection reasoning |
| CrewAI `mcps=[]` DSL not found | Upgrade: `pip install "crewai>=0.100"` |
