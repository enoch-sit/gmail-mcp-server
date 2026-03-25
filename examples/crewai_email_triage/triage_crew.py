"""
Daily Email Triage Crew — Gmail MCP + CrewAI Example
=====================================================

Two agents collaborate to triage your inbox and draft replies:

  • EmailTriageAgent  — searches unread emails, reads each one,
                        and produces a priority-ranked triage report.
  • EmailResponderAgent — for every "Action Required" email, creates
                          a polite draft reply via Gmail (nothing is sent).

Prerequisites
-------------
  1. Build the MCP server first:
        npm install && npm run build          (in the repo root)

  2. Install Python dependencies:
        pip install -r examples/crewai_email_triage/requirements.txt

  3. Set environment variables:
        export GMAIL_CLIENT_ID="..."
        export GMAIL_CLIENT_SECRET="..."
        export GMAIL_REFRESH_TOKEN="..."
        export OPENAI_API_KEY="..."           # or configure a different LLM below

  4. Run:
        python examples/crewai_email_triage/triage_crew.py

Transport used: stdio (MCPServerStdio DSL — requires crewai >= 0.100)
For older crewai, see USAGE.md § "Alternative: MCPServerAdapter".
"""

import os
from pathlib import Path

from crewai import Agent, Crew, LLM, Process, Task
from crewai.mcp import MCPServerStdio

# ─────────────────────────────────────────────────────────────────────────────
# 1.  Locate the compiled MCP server binary
# ─────────────────────────────────────────────────────────────────────────────
# This file lives at:  examples/crewai_email_triage/triage_crew.py
# The repo root is two levels up.
REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_SERVER_PATH = REPO_ROOT / "dist" / "index.js"

if not MCP_SERVER_PATH.exists():
    raise FileNotFoundError(
        f"\nGmail MCP server binary not found at:\n  {MCP_SERVER_PATH}\n\n"
        "Please build it first:\n"
        "  cd <repo-root> && npm install && npm run build\n"
    )

# ─────────────────────────────────────────────────────────────────────────────
# 2.  Configure the Gmail MCP server (stdio transport)
# ─────────────────────────────────────────────────────────────────────────────
# MCPServerStdio launches a child Node.js process that speaks MCP over stdio.
# Credentials are forwarded via the `env` dict — never hardcoded.
gmail_mcp = MCPServerStdio(
    command="node",
    args=[str(MCP_SERVER_PATH)],
    env={
        "GMAIL_CLIENT_ID":     os.environ["GMAIL_CLIENT_ID"],
        "GMAIL_CLIENT_SECRET": os.environ["GMAIL_CLIENT_SECRET"],
        "GMAIL_REFRESH_TOKEN": os.environ["GMAIL_REFRESH_TOKEN"],
    },
    # Discover the 12 Gmail tools once and reuse the list — faster subsequent calls.
    cache_tools_list=True,
)

# ─────────────────────────────────────────────────────────────────────────────
# 3.  LLM configuration  (defaults to OpenAI gpt-4o)
# ─────────────────────────────────────────────────────────────────────────────
# Uncomment ONE of the blocks below to use a different model, or leave as-is
# to use the CrewAI default (OpenAI via OPENAI_API_KEY).

# --- Anthropic Claude ---
# llm = LLM(model="claude-sonnet-4-5", api_key=os.environ["ANTHROPIC_API_KEY"])

# --- Google Gemini ---
# llm = LLM(model="gemini/gemini-1.5-pro", api_key=os.environ["GEMINI_API_KEY"])

# --- Local Ollama ---
# llm = LLM(model="ollama/llama3.1:8b", base_url="http://localhost:11434")

# When no `llm=` is passed, agents use the CrewAI default (OpenAI).
# To override, add `llm=llm` to both Agent(...) calls below.

# ─────────────────────────────────────────────────────────────────────────────
# 4.  Define the agents
# ─────────────────────────────────────────────────────────────────────────────

triage_agent = Agent(
    role="Email Triage Specialist",
    goal=(
        "Read every unread email that arrived in the last 24 hours and produce "
        "a structured triage report sorted by priority."
    ),
    backstory=(
        "You are a meticulous executive assistant who helps busy professionals "
        "cut through inbox noise. You categorise every email accurately and "
        "never miss an urgent message. You always confirm the account you are "
        "reading on behalf of before beginning work."
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
        "human review and approve before anything leaves the outbox. "
        "Your replies are 3–5 sentences: acknowledge, empathise, commit to next step."
    ),
    mcps=[gmail_mcp],
    verbose=True,
)

# ─────────────────────────────────────────────────────────────────────────────
# 5.  Define the tasks
# ─────────────────────────────────────────────────────────────────────────────

triage_task = Task(
    description=(
        "Use the Gmail tools to triage the inbox. Follow these steps exactly:\n\n"
        "Step 1 — Confirm account\n"
        "  Call `get_profile` and note the email address and message count.\n\n"
        "Step 2 — Find unread emails\n"
        "  Call `search_emails` with:\n"
        "    query = \"is:unread newer_than:1d\"\n"
        "    maxResults = 20\n"
        "  If there are no results, report that the inbox is clear and stop.\n\n"
        "Step 3 — Read each email\n"
        "  For every message ID returned, call `read_email` to get the full\n"
        "  headers and body.\n\n"
        "Step 4 — Categorise\n"
        "  Assign each email to exactly one of:\n"
        "    • Urgent          — needs a response within the hour\n"
        "    • Action Required — needs a response today\n"
        "    • FYI             — informational, no reply needed\n"
        "    • Newsletter/Promo — bulk or marketing email\n\n"
        "Step 5 — Produce the triage report (see expected_output)."
    ),
    expected_output=(
        "A Markdown triage report containing:\n\n"
        "1. Header line:  `## Email Triage Report — {date} — {account email}`\n\n"
        "2. A Markdown table with these exact columns:\n"
        "   | Sender | Subject | Category | Summary (one sentence) | Message ID |\n"
        "   Rows are sorted: Urgent first, then Action Required, FYI, Newsletter.\n\n"
        "3. A stats footer line, e.g.:\n"
        "   `Totals: 2 Urgent · 3 Action Required · 5 FYI · 4 Newsletter/Promo`"
    ),
    agent=triage_agent,
)

reply_task = Task(
    description=(
        "Using the triage report from the previous task, draft replies for "
        "Action Required emails. Follow these steps:\n\n"
        "Step 1 — Extract Action Required emails\n"
        "  From the triage table, find every row where Category = 'Action Required'.\n"
        "  If there are none, return 'No Action Required emails found.' and stop.\n\n"
        "Step 2 — Re-read each email for full context\n"
        "  Call `read_email` with each message ID to get the complete thread.\n\n"
        "Step 3 — Draft a reply\n"
        "  For each email, call `create_draft` with:\n"
        "    to      = the sender's email address\n"
        "    subject = 'Re: {original subject}'\n"
        "    body    = a 3–5 sentence professional reply that:\n"
        "              • Greets the sender by first name\n"
        "              • Acknowledges their request\n"
        "              • States a clear, concrete next step with a timeframe\n"
        "              • Closes warmly\n"
        "  ⚠️  DO NOT call `send_email` — drafts only.\n\n"
        "Step 4 — Confirm each draft was created successfully."
    ),
    expected_output=(
        "A Markdown list where each item shows:\n"
        "- **To:** sender name and email\n"
        "- **Subject:** Re: {original subject}\n"
        "- **Draft body:** (full text of the reply)\n"
        "- **Status:** Draft created ✓  (or the error message if it failed)\n\n"
        "Finish with: `{n} draft(s) created successfully.`"
    ),
    agent=responder_agent,
    context=[triage_task],  # the responder sees the triage report as context
)

# ─────────────────────────────────────────────────────────────────────────────
# 6.  Assemble and run the crew
# ─────────────────────────────────────────────────────────────────────────────

crew = Crew(
    agents=[triage_agent, responder_agent],
    tasks=[triage_task, reply_task],
    process=Process.sequential,  # triage must complete before replying
    verbose=True,
)

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Daily Email Triage Crew  —  Gmail MCP + CrewAI")
    print("=" * 60 + "\n")

    result = crew.kickoff()

    print("\n" + "=" * 60)
    print("  FINAL CREW RESULT")
    print("=" * 60)
    print(result)
