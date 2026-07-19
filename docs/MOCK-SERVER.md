# Mock Email Server

The mock email server is a fully local `EmailBackend` implementation backed
by JSON files. It exists for five jobs:

1. **UI preview** - open a populated three-pane client with zero setup.
2. **Automated testing** - the unit suites run against it under plain Node.
3. **Debugging** - reproduce a UI state by editing JSON and refreshing.
4. **Previewing emails** - drop an HTML body into a fixture to see exactly
   how the reader renders (and sanitizes) it.
5. **Mock sending** - exercise the whole compose → validate → send → Sent
   folder flow without an SMTP server.

## Data layout

A mock data folder contains one JSON file per mailbox:

```text
<data-folder>/
├── account.json           # identity used for sent mail and drafts
└── mailboxes/
    ├── inbox.json
    ├── sent.json
    ├── drafts.json
    ├── archive.json
    └── trash.json
```

Any `*.json` file added under `mailboxes/` becomes a mailbox after
**Email Client: Refresh Mailboxes** - the five names above are convention,
not a limit.

## Mailbox file format

```json
{
  "id": "inbox",
  "name": "Inbox",
  "role": "inbox",
  "sortOrder": 1,
  "emails": []
}
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique mailbox id; must match the file name. |
| `name` | string | Display name in the sidebar. |
| `role` | string | `inbox`, `sent`, `drafts`, `trash`, `archive`, or `custom`. Roles drive behavior: deletes move mail to the `trash` mailbox, sends append to `sent`, drafts save to `drafts`. |
| `sortOrder` | number | Sidebar position, ascending. |
| `emails` | array | Messages in the format below. |

## Message format

The message shape is a simplified [JMAP Email object (RFC 8621)](https://www.rfc-editor.org/rfc/rfc8621) -
the modern standard JSON representation of email server data.

```json
{
  "id": "eml-1002",
  "threadId": "thr-billing",
  "mailboxId": "inbox",
  "from": [{ "name": "Acme Corp Billing", "email": "billing@example.com" }],
  "to": [{ "name": "Demo User", "email": "demo-user@example.com" }],
  "cc": [],
  "subject": "Your July billing statement is ready",
  "receivedAt": "2026-07-17T14:03:00Z",
  "preview": "Your billing statement for July is attached.",
  "keywords": { "$seen": false, "$flagged": true },
  "hasAttachment": true,
  "attachments": [
    { "id": "att-2001", "name": "billing-statement-july.pdf", "type": "application/pdf", "size": 48213 }
  ],
  "bodyValues": {
    "text": "Hello,\n\nYour billing statement for July is attached.",
    "html": "<p>Hello,</p><p>Your billing statement for July is attached.</p>"
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Unique within the data folder. |
| `threadId` | string | no | Groups a conversation; informational in this alpha. |
| `mailboxId` | string | yes | Id of the containing mailbox. |
| `from`, `to`, `cc`, `replyTo` | address array | `from`/`to` yes | `{ "name": "Jane Doe", "email": "jane.doe@example.com" }`; `name` optional. |
| `subject` | string | yes | Plain text. |
| `receivedAt` | string | yes | ISO 8601 UTC timestamp; drives list ordering (newest first). |
| `preview` | string | no | Snippet for the list row; keep under ~120 characters. |
| `keywords` | object | yes | JMAP flags: `$seen`, `$flagged`, `$draft`, `$answered`. Absent keys mean `false`. |
| `hasAttachment` | boolean | yes | Shows the paperclip in the list. |
| `attachments` | array | no | Metadata only (`id`, `name`, `type`, `size` in bytes); there are no attachment bodies. |
| `bodyValues` | object | yes | `text` and/or `html`. When both exist the reader prefers `html`. |

## Behavior notes

- **Persistence** - every mutation (flag change, delete, send, draft) is
  written straight back to the JSON files, pretty-printed, so the data stays
  hand-editable and diff-friendly.
- **Seeding** - on first use the bundled samples are copied to a writable
  per-user folder; the shipped fixtures are never modified. **Email Client:
  Reset Mock Server Data** re-copies them over the working set.
- **Trash semantics** - deleting outside trash moves the message into the
  `trash`-role mailbox; deleting inside trash is permanent.
- **Sending** - validated messages are appended to the `sent`-role mailbox
  with the identity from `account.json` conceptually (Demo User,
  `demo-user@example.com`). Sending a stored draft removes it from drafts,
  and replying sets `$answered` on the original message.
- **Simulated failure** - sending to `bounce@example.com` always fails with
  a bounce error. Use it to test the composer's error path.

## Authoring fixtures

1. Run **Email Client: Open Mock Server Data Folder** (or set
   `emailClient.mockDataPath` to a folder in your repo).
2. Edit or add mailbox JSON files following the format above.
3. Run **Email Client: Refresh Mailboxes**.

Tips:

- Keep fixture people and domains generic (Jane Doe, Acme Corp,
  `example.com`) so fixtures can be shared and committed safely.
- To preview an HTML email design, paste the markup into `bodyValues.html`
  of any message. Scripts, frames, and remote images are stripped or blocked
  by design - what you see is what a recipient with a strict client sees.
- Give every message a unique `id`; list ordering comes from `receivedAt`,
  not array position.
