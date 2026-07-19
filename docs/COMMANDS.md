# Commands and Interactions

## Command Palette

| Command | What it does |
| --- | --- |
| **Email Client: Open** | Opens the mail panel, or focuses it if already open. The panel restores its backend state (mailboxes, unread counts) on every open. |
| **Email Client: Compose Email** | Opens the panel and immediately shows the compose dialog. |
| **Email Client: Refresh Mailboxes** | Re-reads the active backend: reloads JSON from disk (mock) or refetches from IMAP (live). Also updates the status bar counter. |
| **Email Client: Switch Backend (Mock / Live)** | Quick-pick between the mock server and live mode. Writes `emailClient.backend` (the flat-settings backend used when no account profile is active); the open panel switches in place. |
| **Email Client: Select Account** | Quick-pick over all discovered accounts from the registry and profiles. Writes `emailClient.activeAccount`. |
| **Email Client: Create Account File** | Opens the Manage Accounts panel and shows the Add Account form. The form writes `accounts/<name>.json` with IMAP and SMTP credentials. |
| **Email Client: Manage Accounts** | Opens the account manager: list, add, edit, and delete `accounts/<name>.json` files. |
| **Email Client: Open Mock Server Data Folder** | Reveals the writable mock data folder in the OS file explorer. |
| **Email Client: Reset Mock Server Data** | After a confirmation, restores the bundled sample mailboxes and discards all local mock changes (sent mail, drafts, flags). |

## Status bar

A mail icon on the left side of the status bar shows the inbox unread count
and the active backend in its tooltip. Clicking it opens the client.

## In-panel interactions

### Toolbar

- **Compose** - new message dialog.
- **Refresh** - same as the refresh command.
- **Search field** - filters the current message list live by sender,
  subject, and preview text (client-side; clearing it restores the list).
- **Backend badge** - shows whether the mock server or live mode is active.

### Message list

- Click a row (or focus it and press `Enter`) to open the message. Opening
  an unread message marks it read and updates all counters. In live mode
  the full message is fetched as HTML via `extractemail -n <N> --html`.
- `↑` / `↓` move focus between rows.
- Unread rows are bold; a flag mark and a paperclip indicate flagged mail
  and attachments.

### Reading pane

- **Reply** - opens the composer prefilled with the sender, a `Re:` subject,
  and the quoted original body as an HTML blockquote. The compose area is
  empty for the user's reply; the quoted block is appended at send time.
- **Flag / Unflag** - toggles `$flagged`.
- **Mark unread** - clears `$seen` and returns to the list.
- **Delete** - in live mode, moves the message to the server Trash folder
  via `extractemail -n <N> --move trash`. In mock mode, moves to Trash.
- Attachments appear as name + size chips (metadata only in this alpha).

### Compose dialog

- Fields: To, Cc, Subject, Message.
- Messages are sent as HTML. User-typed text is stripped of raw HTML tags
  and wrapped in `<div>...</div>`. Reply quotes are appended as a styled
  HTML `<blockquote>`.
- **Send** - validates addresses first; failures show as a toast and the
  dialog stays open with your text intact.
- **Save draft** - stores the message in the Drafts mailbox (mock backend).
- **Discard** - closes without saving.
- `Ctrl+Enter` (`Cmd+Enter` on macOS) sends; `Escape` closes.
- Address fields accept comma-separated entries in either form:
  `jane.doe@example.com` or `Jane Doe <jane.doe@example.com>`.

### Notices

Backend results and errors appear as toasts in the lower-right corner and
dismiss themselves. Errors (send failures, live-mode misconfiguration) stay
readable in place of breaking the panel.
