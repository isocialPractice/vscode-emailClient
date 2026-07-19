# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0-alpha] - 2026-07-18

### Changed

- **Account registry simplified to `accounts/` only.** The `extract-email/accounts/`
  and `send-email/config/accounts/` split folders are no longer searched or
  watched. All credentials live in `accounts/<name>.json`. The single file
  holds both the `extract-email` (IMAP) and `send-email` (SMTP) blocks.
- **Live message open now fetches full HTML.** Clicking a message runs
  `extractemail -n <N> --html --config=<name>` instead of the previous
  `-f` (plaintext) flag. Email HTML is then sanitized and rendered in the
  reading pane.
- **Delete moves to server trash.** Deleting a message calls
  `extractemail -n <N> --move trash --config=<name>` to perform a real
  server-side IMAP move; the in-memory cache is then cleared so the next
  mailbox load reflects the deletion.
- **Compose defaults to HTML.** New messages and replies are sent as
  HTML (`isHtml: true`). User-typed text is stripped of raw HTML tags and
  wrapped in `<div>...</div>` before sending.
- **Replies use HTML blockquote format.** The quoted original is rendered as
  a styled `<blockquote>` element with an attribution line rather than
  plain-text `>` prefixes. The user's reply area is empty by default; the
  quoted block is appended at send time.
- **`Email Client: Create Account File` opens the Add Account UI.** The command
  now opens the Manage Accounts panel and immediately shows the Add Account
  dialog (the same form as clicking "Add Account" from that panel). The old
  behavior of scaffolding a JSON file in `settings/accounts/` is removed.
- **Edit account "Save" now closes the form.** After a successful save the
  host sends a `closeDialog` message; the webview closes the editor overlay
  immediately rather than leaving it open over the refreshed account list.
- **Global CLI tools require no VS Code path settings.** When
  `emailClient.extractEmailPath` and `emailClient.sendEmailPath` are empty
  and an account from the registry is active, the extension invokes
  `extractemail` and `sendemail` directly from `PATH` (using `shell: true`).
  The repo's `extract-email/` working-directory override has been removed;
  globally installed tools resolve their own account configs.

### Added

- `ExtractEmailBridge.moveToTrash(index)` - moves a message server-side
  using `--move trash`.
- `AccountsPanel.openAddDialog()` - public method that posts `openAdd` to
  the webview so the Add Account dialog opens programmatically (used by the
  Create Account File command).

### Removed

- Support for `extract-email/accounts/` and `send-email/config/accounts/`
  as account registry sources.
- `extractGlobalCwd` option from `LiveBackendOptions` and `ExtractEmailBridge`.
- File-system watchers for the split account folders in `extension.ts`.
- `EXTRACT_ACCOUNTS_DIR` and `SEND_ACCOUNTS_DIR` exports from `accountConfig.ts`.
- `identityFromFile` helper (only needed for split native modules).
- The old `createAccountFile` behavior that wrote a placeholder JSON to
  `settings/accounts/`.

### Initial preview release

- Account profiles: named bundles of backend, configuration, and identity.
  Defined in VS Code settings (`emailClient.accounts`) or as JSON files in
  a workspace folder's `settings/accounts/` directory (file name = account
  id; folder files override settings entries with the same id and are
  watched for live changes).
- `emailClient.activeAccount` setting plus **Email Client: Select Account**
  and **Email Client: Create Account File** commands.
- Mock backend sends and drafts use the active account's name and email as
  the From identity; panel badge and status bar show the account name.
- Unit test suite for account discovery, validation, and merging.
- Send-only live accounts: configuring `sendEmailPath` without
  `extractEmailPath` now yields an empty "Inbox (send only)" with working
  compose and send, instead of an error. Covers providers whose servers do
  not allow IMAP extraction (for example, Microsoft Outlook accounts that
  require OAuth 2.0) but still accept SMTP.
- QUICKSTART.md five-minute guide, linked from the README.
- Unit test suite for send-only and unconfigured live backends.
- **Manage Accounts** UI: a webview that opens on the list of configured
  accounts, showing each account's capability, identity, and defining
  file(s), with Edit and Delete per account and an Add Account button. The
  empty state names every folder that was searched. Stored passwords are
  never sent to the webview; leaving a password field untouched keeps the
  value on disk.
- `emailClient.accountsRoot` setting to point the registry at an explicit
  folder.
- Account registry: `accounts/<name>.json` files holding both `extract-email`
  (IMAP) and `send-email` (SMTP) blocks. Capability (extract-only / send-only
  / both) follows from which blocks are present.
- Three-pane webview email client (mailbox sidebar, message list, reading
  pane) themed with VS Code color tokens.
- Compose dialog with reply quoting, draft saving, address validation, and
  Ctrl+Enter send.
- Mock email server: file-backed backend storing mailboxes as simplified
  JMAP (RFC 8621) JSON, seeded from bundled sample data into per-user
  storage; supports read/unread, flagging, trash semantics, drafts, mock
  sending, and a simulated bounce address.
- Experimental live backend: fetch via a locally installed `extract-email`
  CLI (spawned in JSON mode), send via a locally installed `send-email`
  engine (imported as a module).
- Commands: Open, Compose Email, Refresh Mailboxes, Switch Backend,
  Open Mock Server Data Folder, Reset Mock Server Data.
- Status bar unread counter that opens the client.
- Settings: backend selection, mock data path, tool paths, account name,
  message limit.
- HTML email sanitizer plus strict webview Content-Security-Policy
  (nonce-gated scripts, remote images blocked).
- Unit test suites (node:test) covering the mock server, address parsing,
  and the HTML sanitizer.
- Documentation set: architecture, configuration, mock server format,
  commands, testing, and porting notes.

### Known limitations

- Live mode lists only the inbox; IMAP flag changes and deletions are
  session-local (no server write-back).
- Drafts require the mock backend.
- Attachments are displayed as metadata only; download/upload is not
  implemented.
- The prerelease version string must be bumped to `major.minor.patch`
  before Marketplace publishing.

### Initial Work

- Account files were not discovered. Three defects: the split folders were
  searched at the wrong depth (`extract-email/*.json` instead of
  `extract-email/accounts/*`), the master property was read as a flat
  `account` field instead of the single top-level property wrapping the
  file, and the registry searched only workspace folders, so a registry in
  the extension's own folder was never seen. Roots now include an explicit
  `accountsRoot`, every workspace folder, and the extension folder.
- Native `.mjs` / `.js` tool account modules are now recognized (by name and
  capability) instead of ignored. They are never executed.
- `.vscode/launch.json` opens the extension folder in the Extension
  Development Host, so a registry in the repository is in scope on F5.
- Explicit account capability in the live backend, including extract-only
  accounts (empty send path returns a capability-specific message) alongside
  the existing send-only support.
- Account files in all registry folders are watched for live changes; the
  Select Account picker lists registry accounts with their capability.
- Unit suites for the account registry, account store, and extract-only
  backend.
