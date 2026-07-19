# Configuration

All settings live under the `emailClient` namespace. Edit them through the
Settings UI (search for "Email Client") or `settings.json`.

## Accounts

There are two ways to define accounts, both sitting on top of the flat
settings (which still apply when nothing is selected):

- The **live account registry** - the `accounts/` folder at the workspace
  root - is the recommended way to configure real extraction/sending accounts.
  It has its own guide: **[ACCOUNTS.md](ACCOUNTS.md)**.
- **Account profiles** (below) bundle a backend, configuration, and
  identity, defined in VS Code settings or `settings/accounts/` files; they
  also drive the mock backend.

When `emailClient.activeAccount` names an account, the registry is checked
first, then the profiles below.

### Account profiles

An account profile is a named bundle of backend + configuration + identity.

### Two sources

**1. VS Code settings** - the `emailClient.accounts` array, in user or
workspace `settings.json` (workspace overrides user, per normal VS Code
precedence):

```jsonc
{
  "emailClient.accounts": [
    {
      "id": "demo",
      "name": "Demo Inbox",
      "email": "demo-user@example.com",
      "backend": "mock"
    }
  ],
  "emailClient.activeAccount": "demo"
}
```

**2. Folder files** - JSON files in `settings/accounts/` at the root of any
workspace folder. The file name (without `.json`) is the account id.

Folder files usually hold private, machine-specific settings - add
`settings/` to the workspace `.gitignore`. Files are watched: edits, new
files, and deletions apply to a running client immediately.

### Account fields

| Field | Type | Used by | Description |
| --- | --- | --- | --- |
| `id` | string | both | Required in settings entries; taken from the file name for folder files. |
| `name` | string | both | Display name (picker, panel badge, status bar tooltip). |
| `email` | string | mock | Identity address; mock sends and drafts use it (with `name`) as the From address. |
| `backend` | `"mock"` \| `"live"` | both | Defaults to `mock`. |
| `mockDataPath` | string | mock | Data folder; empty uses the per-user default copy. |
| `extractEmailPath` | string | live | Local extract-email installation. Leave empty when `extractemail` is on `PATH`. |
| `sendEmailPath` | string | live | Local send-email installation. Leave empty when `sendemail` is on `PATH`. |
| `toolAccount` | string | live | Account name configured inside those tools. |
| `messageLimit` | number | both | Per-account override of `emailClient.messageLimit` (1-500). |

## Settings reference

### `emailClient.activeAccount`

- Type: `string` - Default: `""`

Name of the active account from the registry or a profile id. Empty means
no account: the flat settings below apply directly. Set interactively with
**Email Client: Select Account**.

### `emailClient.accounts`

- Type: `array` - Default: `[]`

Account profiles defined in VS Code settings. See the Accounts section
above for the entry format and how folder files interact with this list.

### `emailClient.backend`

- Type: `"mock" | "live"` - Default: `"mock"`

Selects the active backend when no account profile is active. `mock` uses
the built-in mock email server (local JSON, no network). `live` fetches
through the globally installed `extractemail` CLI and sends through the
globally installed `sendemail` CLI. The **Email Client: Switch Backend**
command toggles this setting.

### `emailClient.mockDataPath`

- Type: `string` - Default: `""`

Absolute path to a mock server data folder (one containing a `mailboxes/`
subfolder). When empty, the extension uses a writable per-user copy of the
bundled sample data, created on first use inside VS Code's global storage.

### `emailClient.extractEmailPath`

- Type: `string` - Default: `""`

Absolute path to a locally built **extract-email** installation. Leave empty
when `extractemail` is on `PATH` (installed globally via
`npm install -g extract-email`).

### `emailClient.sendEmailPath`

- Type: `string` - Default: `""`

Absolute path to a locally built **send-email** installation. Leave empty
when `sendemail` is on `PATH` (installed globally via
`npm install -g send-email`).

### `emailClient.account`

- Type: `string` - Default: `""`

Account name for the flat-settings live backend (no registry account active).
Passed as `--config=<name>` to `extractemail` and as `--account <name>` to
`sendemail`.

### `emailClient.messageLimit`

- Type: `number` - Default: `50` (range 1-500)

Maximum number of messages loaded per mailbox.

## Live mode walkthrough

1. **Install the CLI tools globally:**

   ```bash
   npm install -g extract-email
   npm install -g send-email
   ```

2. **Create an account file** with **Email Client: Create Account File** or
   **Email Client: Manage Accounts** - Add Account. The form writes
   `accounts/<name>.json` in the workspace with your IMAP and SMTP
   credentials.

3. **Select the account** with **Email Client: Select Account** and pick the
   name you just created.

The extension discovers the `accounts/` folder automatically once a workspace
folder is open. No `emailClient.extractEmailPath` or
`emailClient.sendEmailPath` settings are needed.

## How to enter credentials

The extension stores credentials directly in `accounts/<name>.json` files
in the workspace. Use **Email Client: Create Account File** or the
**Add Account** / **Edit** actions in **Email Client: Manage Accounts** to
fill in the form - the extension writes the file for you.

All examples below use placeholder data - substitute your own address,
password, and mail server.

### Account file format

```json
{
  "work": {
    "extract-email": {
      "imap": {
        "host": "imap.example.com",
        "port": 993,
        "user": "jane.doe@example.com",
        "password": "app-password-here",
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

Save this as `accounts/work.json` in the workspace root. The top-level key
must match the file name.

### Credential safety

- Prefer an **app password** (a per-application password issued by your
  provider) over your main account password whenever the provider offers
  them.
- Keep `accounts/` out of version control - add it to `.gitignore`. The
  bundled `accounts/example.json.template` shows the expected structure
  without real values.
- Rotating a password means editing the account file (or using
  **Manage Accounts** > Edit). No settings change is needed.

> **Note: email servers not supporting IMAP extraction.** Some providers
> do not allow IMAP for third-party apps (Microsoft Outlook requires
> OAuth 2.0). Accounts on such servers can still be used **send-only**:
> create an account file with only the `send-email` block. The client
> shows an empty "Inbox (send only)" and composing/sending work normally.

### Troubleshooting live mode

| Symptom | Fix |
| --- | --- |
| "extract-email timed out" | Check your IMAP host/port/credentials in the account file. |
| "extract-email exited with code ..." | Run `extractemail --config=<name> 5` in a terminal to see the full error. |
| Send fails with an SMTP error | Verify `send-email` block settings: host, port, secure, auth credentials. |
| Panel shows an error toast but stays usable | Expected - all backend failures degrade to notices. Switch to the mock backend to keep working. |

## Where mock data lives

With `emailClient.mockDataPath` empty, the writable copy sits in the
extension's global storage folder (a per-user VS Code location). You never
need the exact path in practice:

- **Email Client: Open Mock Server Data Folder** reveals it in your file
  explorer.
- **Email Client: Reset Mock Server Data** restores the bundled samples.
