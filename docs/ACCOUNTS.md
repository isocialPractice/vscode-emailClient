# Account Registry

All live accounts are stored as one-stop JSON files inside a single
`accounts/` folder at the registry root:

```text
<registry-root>/
└── accounts/
    ├── work.json
    └── personal.json
```

The file base name is the account name. A file may hold both IMAP
(extraction) and SMTP (sending) credentials, or only one, making the
account **extract-only**, **send-only**, or **both**.

Manage everything visually with **Email Client: Manage Accounts** - it
lists every account with its capability and offers Edit, Delete, and Add
Account. **Email Client: Create Account File** opens the same Add Account
dialog directly.

## Where the registry is searched

Roots are searched in this order, most specific first:

1. `emailClient.accountsRoot`, when set to an absolute path.
2. Every open workspace folder.
3. The extension's own folder (so a registry inside the extension
   repository is found when running it from source).

When a name appears under more than one root, the first root wins. The
Manage Accounts panel lists the exact folders it searched, which is the
quickest way to confirm a file is in a location the extension reads.

## Account file format

A file in `accounts/` holds **exactly one top-level property - the master
property - and it must match the file name**. Inside it, an optional
`extract-email` block (IMAP) and/or an optional `send-email` block (SMTP):

```json
{
  "work": {
    "extract-email": {
      "imap": {
        "user": "jane.doe@example.com",
        "password": "app-password-here",
        "host": "imap.example.com",
        "port": 993,
        "tls": true,
        "authTimeout": 3000
      }
    },
    "send-email": {
      "host": "smtp.example.com",
      "port": 587,
      "secure": false,
      "auth": {
        "user": "jane.doe@example.com",
        "pass": "app-password-here"
      }
    }
  }
}
```

- The `extract-email` block uses the IMAP credentials expected by the
  `extractemail` CLI (`host`, `port`, `user`, `password`, `tls`).
- The `send-email` block uses nodemailer-compatible SMTP settings
  (`host`, `port`, `secure`, `auth`).
- Include only the `extract-email` block for an extract-only account, or
  only the `send-email` block for a send-only account.

## Rules

1. **Master property matches the file name.** An `accounts/<name>.json`
   file must contain exactly one top-level property named `<name>`. Anything
   else is skipped with a warning naming the file.
2. **Only `.json` files are accepted** in the `accounts/` folder. Template
   files (ending in `.template`) are ignored.
3. **Passwords are never sent to the Manage Accounts webview.** Stored
   secrets are replaced with a sentinel; leaving a password field untouched
   on Edit keeps the value on disk unchanged.

## Credential safety

Account files contain plaintext credentials. Add `accounts/` (or your
configured `emailClient.accountsRoot`) to the workspace `.gitignore` to
prevent them from being committed. The bundled `accounts/example.json.template`
shows the expected structure without real values.

## Capability

| Files present for name `work` | Capability |
| --- | --- |
| `accounts/work.json` with both blocks | both |
| `extract-email/accounts/work.mjs` + `send-email/config/accounts/work.js` | both |
| `accounts/work.json` with only `extract-email` | extract only |
| `extract-email/accounts/work.mjs` only | extract only |
| `accounts/work.json` with only `send-email` | send only |
| `send-email/config/accounts/work.js` only | send only |

A send-only account shows an empty "Inbox (send only)" while compose and
send work normally - useful for providers whose servers do not allow IMAP
extraction (for example, Microsoft Outlook accounts that require an OAuth 2.0
flow) but still accept SMTP. An extract-only account reads mail and reports a
clear message if a send is attempted.

## Managing accounts

**Email Client: Manage Accounts** opens on the account list. Each row shows
the name, capability, identity address, defining file(s), and whether the
account is active.

- **Add Account** creates a one-stop `accounts/<name>.json` under the first
  registry root, using the capability chosen in the form.
- **Edit** opens the same form for JSON accounts. Stored passwords are never
  sent to the panel: the password fields show a placeholder, and leaving
  them untouched keeps the password already on disk.
- **Delete** removes every file that defines the account, after a
  confirmation prompt.

To make an account active, use **Email Client: Select Account**.

## Credentials

Account files hold real credentials, so keep the registry folders
git-ignored:

```gitignore
accounts/
extract-email/
send-email/
```

Prefer an app password over your main account password wherever the provider
offers one. See
[CONFIGURATION.md - How to enter credentials](CONFIGURATION.md#how-to-enter-credentials)
for the companion tools' own account files.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Account does not appear | The file is outside every searched root. Open Manage Accounts to see the searched folders, or set `emailClient.accountsRoot`. |
| "master property ... must match the file name" | The top-level property name and the file name differ. Rename one to match. |
| "expected exactly one top-level property" | The file has zero or several top-level keys; wrap everything in a single property named after the file. |
| "has neither an extract-email nor a send-email block" | Add at least one of the two blocks. |
| Account shows `tool module` and Edit opens a file | It is defined by a native `.mjs` / `.js` module, which is edited directly rather than through the form. |
| Account listed but nothing loads | The registry supplies the account; the transport still needs `emailClient.extractEmailPath` / `emailClient.sendEmailPath` pointing at built tool installations. |

Note that `.gitignore` never affects discovery - account files are read
directly from disk, so ignoring them is safe and recommended.
