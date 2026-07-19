# Porting Notes

This extension is a port of two standalone Node CLI tools into one VS Code
extension. Neither tool's code was copied in; each is consumed through the
integration style that fits its architecture.

## The two sources

| Tool | What it does | Architecture |
| --- | --- | --- |
| **extract-email** | Extracts messages from IMAP accounts; filtering, tasks, JSON output. | CLI whose entry module executes on import - not embeddable as a library. |
| **send-email** | Sends single or bulk SMTP email; accounts, templates, attachments. | Ships an interface-agnostic `EmailEngine` class explicitly designed for embedding in GUIs. |

## Integration styles

### extract-email → API call

Because the CLI runs on import, embedding it would execute its argument
parsing and config loading inside the extension host. Instead,
[`extractEmailBridge.ts`](../src/services/extractEmailBridge.ts) treats each
fetch like a request to an external service:

1. Spawn `node <tool>/dist/extractEmail.js --json <count> [--config <name>]`
   with the tool's folder as the working directory.
2. Collect stdout and parse it tolerantly (a single JSON document or
   newline-delimited JSON objects, ignoring surrounding log lines).
3. Normalize each record (mailparser-shaped fields: `from`, `to`, `subject`,
   `date`, `text`, `html`, `attachments`) into the extension's JMAP-style
   `EmailMessage`.

The process boundary also isolates the extension from the tool's dependency
tree and any future CLI changes short of the JSON shape.

### send-email → dependency

[`sendEmailBridge.ts`](../src/services/sendEmailBridge.ts) imports the
tool's built `dist/core/engine.js` as an ES module and drives it directly:

```text
createEngineConfig(toolRoot) → new EmailEngine(config)
  → engine.initialize(account)   // account from the tool's config/accounts/
  → engine.sendEmail(message)    // nodemailer-compatible message
```

One wrinkle: this extension compiles to CommonJS (the VS Code default),
where TypeScript rewrites `import()` into `require()` - which cannot load an
ES module. [`importEsm.ts`](../src/utils/importEsm.ts) routes the call
through the Function constructor so a genuine dynamic `import()` survives
compilation.

## Feature mapping

| Source capability | In this extension |
| --- | --- |
| extract-email: fetch latest N messages | Live inbox (`emailClient.messageLimit`). |
| extract-email: account/config selection (`--config`) | `emailClient.account`. |
| extract-email: filters, tasks, attachment download | Not ported; still available in the CLI itself. |
| send-email: single send (normal mode) | Compose dialog in both backends. |
| send-email: account modules | Used as-is via `emailClient.account`; credentials stay in the tool. |
| send-email: address validation | Reimplemented in [`address.ts`](../src/utils/address.ts) (shared by mock and live send). |
| send-email: bulk lists, templates, globals, DSN | Not ported; the engine still supports them for CLI use. |
| Both: terminal output/logging | Replaced by the panel UI, toasts, and the status bar counter. |

## What is new in the port

- The **unified domain model** (simplified JMAP) both sources are mapped
  into - neither CLI has a mailbox/keyword model.
- The **mock email server**, which stands in for both tools so the client
  works with no accounts configured.
- The **webview UI**, sanitizer, and CSP - the CLIs had no rendering
  surface and therefore no HTML-safety layer.

## Known gaps (alpha)

- Live mode surfaces only the inbox; folder listing, IMAP flag write-back,
  and server-side deletes are future work in the extract-email bridge.
- Drafts persist only in the mock backend.
- Attachment bodies are not fetched or sent in either mode.
