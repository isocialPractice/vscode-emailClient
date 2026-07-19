# Quickstart

Get the email client running in about five minutes. No email account is
needed for the first half of this guide - the built-in mock server provides
a working inbox out of the box.

## 1. Build and launch

```bash
npm install
npm run build
```

Open the folder in VS Code and press `F5` (**Run Extension**). A new
Extension Development Host window opens.

## 2. Open the client

In the development host window, open the Command Palette (`Ctrl+Shift+P`)
and run:

```text
Email Client: Open
```

The three-pane client opens on a sample inbox: mailboxes on the left,
messages in the middle, and the reading pane on the right. A mail icon in
the status bar shows the unread count.

## 3. Try the core flows

- **Read** - click a message; unread messages turn read everywhere.
- **Reply** - use the Reply button in the reading pane; the composer opens
  with the original message quoted.
- **Send** - compose to any address, for example `jane.doe@example.com`,
  and press Send (`Ctrl+Enter`). The message lands in the Sent mailbox.
- **Test a failure** - send to `bounce@example.com` to see the error path.
- **Drafts, flags, trash** - Save draft, Flag, and Delete all work and
  persist between sessions.

Everything so far ran against local JSON files - no network, no
credentials. To reset the sample data at any time, run
**Email Client: Reset Mock Server Data**.

## 4. Connect a real account (optional)

Live mode uses two locally installed companion tools: **extract-email**
(fetches mail over IMAP) and **send-email** (sends over SMTP). Credentials
are entered in those tools' account files - never in this extension. The
full walkthrough, including where the credentials go, is in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md); the short version:

1. Install and build both tools (`npm install && npm run build` in each).
2. Enter your email address and password in each tool's account file
   (see [How to enter credentials](docs/CONFIGURATION.md#how-to-enter-credentials)).
3. Create an account profile: run **Email Client: Create Account File**,
   then fill in the tool paths:

   ```json
   {
     "name": "Acme Corp",
     "backend": "live",
     "extractEmailPath": "C:\\tools\\extract-email",
     "sendEmailPath": "C:\\tools\\send-email",
     "toolAccount": "example"
   }
   ```

4. Run **Email Client: Select Account** and pick the profile.

> **Note:** some providers do not allow IMAP extraction for third-party
> apps (Microsoft Outlook accounts are a common example - their servers
> require an OAuth 2.0 flow the extraction tool does not implement). Those
> accounts can still be configured **send-only**: leave
> `extractEmailPath` empty and set only `sendEmailPath`. The client then
> shows an empty inbox but composing and sending work normally.

## 5. Where to go next

- [README.md](README.md) - feature overview and project layout
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) - all settings, accounts, credentials
- [docs/MOCK-SERVER.md](docs/MOCK-SERVER.md) - edit or author the sample mailboxes
- [docs/COMMANDS.md](docs/COMMANDS.md) - every command and keyboard shortcut
