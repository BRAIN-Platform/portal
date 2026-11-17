---
title: Obtaining and Configuring a BRAIN API Key
description: Generate, configure, and secure a BRAIN API key for programmatic access and coding agents
---

# Obtaining and Configuring a BRAIN API Key

A **BRAIN API key** authenticates programmatic requests to the [BRAIN API](api.md)
and connects external [coding agents](agents.md) (such as Claude Code, OpenAI
Codex CLI, and OpenCode) to models hosted at Brookhaven National Laboratory.

> **Access** — BRAIN is available only on the BNL network or through the BNL
> VPN. Sign in with your Brookhaven Lab account to manage API keys.

### BRAIN API endpoints

| Resource | URL |
|---|---|
| API Service | [`https://api.brain.bnl.gov`](https://api.brain.bnl.gov) |
| API Key Manager | [`https://api.brain.bnl.gov/km/`](https://api.brain.bnl.gov/km/) |

---

## 1. Generate and Manage an API Key

1. Connect to the BNL network or BNL VPN.
2. Open the **BRAIN API Key Manager** ([BRAIN API endpoints](#brain-api-endpoints))
   and sign in with your Brookhaven Lab account.
3. Under **Your API Keys**, generate your key. Each account holds **one active
   key** at a time, and the full secret is only displayed when it is created, so
   copy it immediately.

Available actions in **Your API Keys**:

- **`Generate New Key`** — creates a new key; **`Regenerate All`**
  deletes any existing key before generating a replacement (breaking tools
  still using the old key).
- **`Extend +30d`** — extends the active key's expiration date (**Expires**) by
  30 days.
- **`Delete`** — immediately deletes and revokes the active key.

---

## 2. Set `BRAIN_API_KEY` in Your Shell

Avoid running `export BRAIN_API_KEY="your-brain-api-key"` directly on the command
line or adding a plaintext key to `~/.bashrc` or `~/.zshrc` (see [Security and Data
Handling](#4-security-and-data-handling)). Instead, choose one of the options below:

### Option A: Current session only (recommended for interactive use)

Prompt silently for the key so it is not echoed to the terminal or saved in
shell history (`~/.bash_history` / `~/.zsh_history`):

```bash
printf "BRAIN API Key: " && read -rs BRAIN_API_KEY && echo && export BRAIN_API_KEY
```

### Option B: Restricted key file (for reuse across sessions)

Write the key to an owner-only file (`0600` permissions) without echoing it or
recording it in shell history:

```bash
printf "BRAIN API Key: " && read -rs KEY && echo && (umask 077 && printf '%s\n' "$KEY" > ~/.brain_api_key) && unset KEY
```

Load it on demand only in the terminal session where you need it:

```bash
export BRAIN_API_KEY="$(< ~/.brain_api_key)"
```

Alternatively, store the key in your OS keychain or secret manager (such as macOS
Keychain or `pass`) and load `BRAIN_API_KEY` from there when needed.

### Verify

Confirm that the variable is set in your active shell:

```bash
[ -n "$BRAIN_API_KEY" ] && echo "BRAIN_API_KEY is set" || echo "BRAIN_API_KEY is NOT set"
```

---

## 3. Authenticate Requests

- **HTTP / `curl` requests:** Pass the key in the `Authorization` header:
  ```text
  Authorization: Bearer $BRAIN_API_KEY
  ```
- **Swagger UI (BRAIN API Service):** Select **Authorize** at the top
  right and enter `Bearer <your-brain-api-key>`.
- **SDKs and coding agents:** Configure your client or agent to read
  `BRAIN_API_KEY` from the environment at runtime (see the [API guide](api.md)
  and [coding agents guide](agents.md)).

---

## 4. Security and Data Handling

> **Security** — Treat your API key like a password:
> - **Do not store plaintext keys in `~/.bashrc`, `~/.zshrc`, or other shell
>   startup files.** Dotfiles often have readable permissions (`0644`), may live
>   on shared/networked filesystems or be backed up to dotfiles repositories,
>   and expose `BRAIN_API_KEY` to every process in every terminal session.
> - **Do not type the literal key in shell commands** (for example,
>   `export BRAIN_API_KEY="sk-..."`), as it is saved in plaintext in
>   `~/.bash_history` or `~/.zsh_history`.
> - **Never commit keys to Git, paste them into issue trackers, or hardcode them
>   in source code or configuration files.** Always read `BRAIN_API_KEY` from the
>   environment or a secret manager at runtime.
> - **Revoke exposed keys immediately** using **Delete** or **Regenerate All**
>   in the **BRAIN API Key Manager** if a key is leaked or no longer needed.
>
> **Sensitive data** — Even though prompts and outputs remain on BNL
> infrastructure, follow BNL's
> [Artificial Intelligence Policy](https://intranet.bnl.gov/itd/ai-policy.php)
> (*internal link*) and your data-classification rules when sending files or
> information to the API.
