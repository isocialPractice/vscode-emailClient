# Email Client for VS Code

Read, preview, compose, and send email without leaving VS Code. The extension
bridges globally installed `extractemail` and `sendemail` CLI tools behind a
single three-pane mail interface, and ships a built-in **mock email server**
so the entire UI works out of the box with no account, no credentials, and no
network access.

> **Status:** `0.0.0-alpha` - early preview. The mock backend is fully
> functional; the live backend is experimental. See [CHANGELOG.md](CHANGELOG.md).

## Features

- **Three-pane mail UI** - mailbox sidebar, message list, and reading pane in
  a VS Code webview panel that follows your color theme (light and dark).
- **Compose, reply, drafts** - modal composer that sends as HTML, wraps
  messages in a `<div>`, generates quoted-reply blockquotes, and supports
  Ctrl+Enter to send.
- **Mock email server** - a local, file-backed email server storing messages
  as simplified JMAP (RFC 8621) JSON. Use it for UI preview, automated tests,
  debugging, previewing email rendering, and mock sending.
- **Account registry with a management UI** - configure real accounts as
  one-stop JSON in `accounts/<name>.json` containing IMAP and SMTP
  credentials. **Email Client: Manage Accounts** lists every account with
  Add, Edit, and Delete. **Email Client: Create Account File** opens the same
  Add Account form directly. See [docs/ACCOUNTS.md](docs/ACCOUNTS.md).
- **Account profiles** - alternatively, define named accounts in VS Code
  settings (`emailClient.accounts`) or as JSON files in a workspace folder's
  `settings/accounts/` directory. Each profile bundles a backend with its
  configuration and identity; switch with **Email Client: Select Account**.
- **Live mode (experimental)** - fetch real mail through the globally
  installed `extractemail` CLI (`npm install -g extract-email`) and send
  through the globally installed `sendemail` CLI (`npm install -g send-email`).
  No VS Code path settings are required when the tools are on `PATH`.
  Messages are opened with `--html` for full HTML rendering. Deleting a
  message moves it server-side to the Trash folder via `--move trash`.
- **Safe HTML rendering** - email bodies are sanitized in the extension host
  and rendered under a strict Content-Security-Policy. Scripts never run and
  remote images are blocked by default, matching desktop mail client privacy
  norms.
- **Unread badge** - a status bar item shows the inbox unread count and opens
  the client on click.
- **Search and keyboard navigation** - client-side filtering over sender,
  subject, and preview text; arrow-key navigation in the message list; full
  focus-visible support.

## Quick Start (no account needed)

> New here? [QUICKSTART.md](QUICKSTART.md) walks through first launch,
> the core flows, and connecting a real account in about five minutes.

1. Clone the repository and install dependencies:

   ```bash
   npm install
   npm run build
   ```

2. Open the folder in VS Code and press `F5` (**Run Extension**). A new
   Extension Development Host window opens.

3. In that window, run **Email Client: Open** from the Command Palette
   (`Ctrl+Shift+P`).

The client opens on the mock inbox with sample conversations between
placeholder people (Jane Doe, John Smith, Alice, Bob) at `example.com`.
Everything works immediately: read messages, flag them, reply, save drafts,
delete to trash, and "send" mail that lands in the mock Sent folder.

## Commands

| Command | Description |
| --- | --- |
| `Email Client: Open` | Open (or focus) the mail panel. |
| `Email Client: Compose Email` | Open the panel with the composer ready. |
| `Email Client: Refresh Mailboxes` | Re-read mailboxes from the active backend. |
| `Email Client: Switch Backend (Mock / Live)` | Toggle between the mock server and live mode (flat settings). |
| `Email Client: Select Account` | Pick an account profile (or the default flat settings). |
| `Email Client: Create Account File` | Open the Add Account form (same as Manage Accounts) to create a new `accounts/<name>.json`. |
| `Email Client: Manage Accounts` | Open the account manager: list, add, edit, and delete accounts. |
| `Email Client: Open Mock Server Data Folder` | Reveal the writable mock data folder in your file explorer. |
| `Email Client: Reset Mock Server Data` | Restore the bundled sample mailboxes (discards local changes). |

Full details: [docs/COMMANDS.md](docs/COMMANDS.md).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `emailClient.accountsRoot` | `""` | Folder holding the account registry; empty searches workspace folders and the extension folder. |
| `emailClient.activeAccount` | `""` | Name of the account profile to use; empty uses the flat settings below. |
| `emailClient.accounts` | `[]` | Account profiles; also definable as `settings/accounts/*.json` files per workspace folder. |
| `emailClient.backend` | `mock` | `mock` (local JSON mailboxes) or `live`. |
| `emailClient.mockDataPath` | `""` | Custom mock data folder; empty uses a per-user writable copy of the bundled samples. |
| `emailClient.extractEmailPath` | `""` | Path to a locally built `extract-email` installation. Leave empty when `extractemail` is on `PATH`. |
| `emailClient.sendEmailPath` | `""` | Path to a locally built `send-email` installation. Leave empty when `sendemail` is on `PATH`. |
| `emailClient.account` | `""` | Account name for the flat settings (not the registry). |
| `emailClient.messageLimit` | `50` | Messages loaded per mailbox. |

Full details and live-mode setup: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## The Mock Email Server

The mock server is a first-class feature, not a test shim. It stores each
mailbox as one JSON file using a simplified JMAP Email shape:

```json
{
  "id": "eml-1001",
  "from": [{ "name": "Jane Doe", "email": "jane.doe@example.com" }],
  "to": [{ "name": "Demo User", "email": "demo-user@example.com" }],
  "subject": "Welcome to Acme Corp - your onboarding checklist",
  "receivedAt": "2026-07-18T08:12:00Z",
  "keywords": { "$seen": false },
  "hasAttachment": false,
  "bodyValues": { "html": "<p>Welcome aboard!</p>" }
}
```

On first use the bundled samples are copied to a writable per-user location
(VS Code global storage), so reading, flagging, sending, and deleting all
persist between sessions without touching the shipped fixtures. Sending to
`bounce@example.com` simulates a delivery failure so error handling can be
exercised deliberately.

Format specification, data location, and fixture-authoring guide:
[docs/MOCK-SERVER.md](docs/MOCK-SERVER.md).

## Live Mode (experimental)

Live mode works with globally installed CLI tools. Install once:

### Extract Email (*[extractEmail](https://github.com/isocialPractice/extractEmail.git)*)

```bash
# outside of this directory
git clone https://github.com/isocialPractice/extractEmail.git
cd extractEmail
npm install
npm run build
npm link
```

### Send Email (*[sendEmail](https://github.com/isocialPractice/sendEmail.git)*)

```bash
# outside of this directory
git clone https://github.com/isocialPractice/sendEmail.git
cd sendEmail
npm install
npm run build
npm link
```

Then create an account in `accounts/<name>.json`:

```jsonc
{
  "myaccount": {
    "extract-email": {
      "imap": {
        "host": "imap.example.com",
        "port": 993,
        "user": "me@example.com",
        "password": "app-password",
        "tls": true
      }
    },
    "send-email": {
      "host": "smtp.example.com",
      "port": 587,
      "secure": false,
      "auth": { "user": "me@example.com", "pass": "app-password" }
    }
  }
}
```

Or use **Email Client: Create Account File** / **Email Client: Manage Accounts** to
build this file through a GUI form. Then run **Email Client: Select Account** to
activate it.

The extension calls `extractemail --config=<name> <limit>` to list messages,
`extractemail -n <N> --html --config=<name>` to open individual messages in HTML,
and `extractemail -n <N> --move trash --config=<name>` to delete. Sending calls
`sendemail --send-to <addr> --subject <subject> --message-file <path> --force --account <name>`.

No VS Code path settings are needed when the tools are on `PATH`. Set
`emailClient.extractEmailPath` or `emailClient.sendEmailPath` only when
pointing at a non-global local build.

Known alpha limitations: only the inbox is listed, IMAP flag changes other
than trash-moves are session-local, and drafts require the mock backend. See
[docs/PORTING.md](docs/PORTING.md) for the complete feature mapping.

## Project Layout

```text
├── src/
│   ├── extension.ts              Activation, commands, status bar
│   ├── panel/emailClientPanel.ts Webview panel and message pump
│   ├── services/
│   │   ├── backend.ts            EmailBackend interface
│   │   ├── mockEmailServer.ts    Mock server (file-backed backend)
│   │   ├── liveBackend.ts        Live backend (combines the bridges)
│   │   ├── extractEmailBridge.ts extract-email as an external API call
│   │   └── sendEmailBridge.ts    send-email engine as a dependency
│   ├── utils/                    Address parsing, HTML sanitizer, ESM import
│   ├── types.ts                  Domain model + webview protocol
│   └── test/                     node:test unit suites
├── media/                        Webview CSS and JS
├── mock-server/                  Bundled sample mailboxes (JMAP-style JSON)
└── docs/                         Detailed documentation
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - layers, data flow, webview protocol, security model
- [docs/ACCOUNTS.md](docs/ACCOUNTS.md) - live account registry: folders, capabilities, rules
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) - every setting, with live-mode walkthrough
- [docs/MOCK-SERVER.md](docs/MOCK-SERVER.md) - mock data format and authoring guide
- [docs/COMMANDS.md](docs/COMMANDS.md) - commands and in-panel interactions
- [docs/TESTING.md](docs/TESTING.md) - running and writing tests
- [docs/PORTING.md](docs/PORTING.md) - how the two source tools map into this extension

## Development

```bash
npm install         # install dev dependencies
npm run build       # compile TypeScript to dist/
npm run watch       # compile on change
npm test            # build + run unit tests (pure Node, no VS Code download)
npm run pre:publish # make file to install from vsix
```

Press `F5` in VS Code to launch the Extension Development Host with the build
task wired in.

### Versioning note

The package version `0.0.0-alpha` is a semver prerelease. The VS Code
Marketplace requires a plain `major.minor.patch` version, so publishing will
require bumping to (for example) `0.1.0`. Local development and `F5` runs are
unaffected.

## License

[ISC](LICENSE)
