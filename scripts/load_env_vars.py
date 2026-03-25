"""
load_env_vars.py

Reads Gmail OAuth credentials from credentials/credentials.json and
credentials/token.json, then persists them as user-scoped environment variables.

  Windows  — writes to HKEY_CURRENT_USER\\Environment (registry)
  macOS    — writes export lines to ~/.zshrc (falls back to ~/.bash_profile)
  Linux    — writes export lines to ~/.bashrc (falls back to ~/.profile)

Prints only character counts — never the actual secret values.

Usage:
    python scripts/load_env_vars.py
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDENTIALS_FILE = REPO_ROOT / "credentials" / "credentials.json"
TOKEN_FILE        = REPO_ROOT / "credentials" / "token.json"


# ── Platform helpers ──────────────────────────────────────────────────────────

def _set_windows(name: str, value: str) -> None:
    import winreg  # available only on Windows
    key = winreg.OpenKey(
        winreg.HKEY_CURRENT_USER,
        r"Environment",
        0,
        winreg.KEY_SET_VALUE,
    )
    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
    winreg.CloseKey(key)


def _shell_profile() -> Path:
    """Return the most appropriate shell profile file for the current user."""
    shell = os.environ.get("SHELL", "")
    home  = Path.home()
    if sys.platform == "darwin":
        # zsh is the default since macOS Catalina; fall back to bash_profile
        return home / ".zshrc" if "zsh" in shell else home / ".bash_profile"
    # Linux: prefer bashrc, fall back to .profile (POSIX, works for all shells)
    return home / ".bashrc" if "bash" in shell else home / ".profile"


def _set_posix(name: str, value: str) -> Path:
    """Write (or update) an export line in the user's shell profile."""
    profile = _shell_profile()
    export_line = f'export {name}="{value}"'
    prefix      = f"export {name}="

    if profile.exists():
        lines = profile.read_text(encoding="utf-8").splitlines()
    else:
        lines = []

    # Remove any pre-existing definition for this variable
    lines = [l for l in lines if not l.startswith(prefix)]
    lines.append(export_line)

    profile.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return profile


# ── Main entry ────────────────────────────────────────────────────────────────

def main() -> None:
    # ── Read credentials.json ─────────────────────────────────────────────────
    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError(f"Not found: {CREDENTIALS_FILE}")

    creds = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
    installed = creds.get("installed") or creds.get("web")
    if not installed:
        raise ValueError("credentials.json must have an 'installed' or 'web' key")

    client_id     = installed["client_id"]
    client_secret = installed["client_secret"]

    # ── Read token.json ───────────────────────────────────────────────────────
    if not TOKEN_FILE.exists():
        raise FileNotFoundError(
            f"Not found: {TOKEN_FILE}\n"
            "Run `npm run setup:cli` or the web wizard first to generate a token."
        )

    token = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise ValueError(
            "token.json does not contain a 'refresh_token' key.\n"
            "Re-run the OAuth setup wizard — ensure you authorized with offline access."
        )

    # ── Persist environment variables ─────────────────────────────────────────
    vars_to_set = {
        "GMAIL_CLIENT_ID":     client_id,
        "GMAIL_CLIENT_SECRET": client_secret,
        "GMAIL_REFRESH_TOKEN": refresh_token,
    }

    profile: Path | None = None

    for name, value in vars_to_set.items():
        if sys.platform == "win32":
            _set_windows(name, value)
        else:
            profile = _set_posix(name, value)
        print(f"  ✓  {name:<25} set  ({len(value)} chars)")

    print()
    if sys.platform == "win32":
        print("Done. Fully close and reopen VS Code to pick up the new variables.")
        print("Then restart the gmail MCP server: Ctrl+Shift+P → MCP: List Servers → Restart")
    else:
        print(f"Done. Variables written to {profile}")
        print(f"Run:  source {profile}")
        print("Then restart the gmail MCP server: Ctrl+Shift+P → MCP: List Servers → Restart")


if __name__ == "__main__":
    main()
