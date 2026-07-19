# Architecture

## Overview

The extension is organized in three layers with strict dependencies pointing
downward. The UI never talks to a concrete backend, and backends never import
the `vscode` API - which is what makes them swappable at runtime and testable
under plain Node.

```text
┌────────────────────────────────────────────────────────────┐
│  Webview (media/main.js + main.css)                        │
│  Three-pane UI, compose dialog, toasts, keyboard handling  │
└──────────────────────────┬─────────────────────────────────┘
                           │ postMessage protocol (typed)
┌──────────────────────────┴─────────────────────────────────┐
│  Extension host                                            │
│  extension.ts        commands, settings, status bar        │
│  emailClientPanel.ts webview lifecycle + message pump      │
│  sanitizeHtml.ts     body sanitation before display        │
└──────────────────────────┬─────────────────────────────────┘
                           │ EmailBackend interface
        ┌──────────────────┴───────────────────┐
┌───────┴────────────┐              ┌──────────┴───────────────┐
│  MockEmailServer   │              │  LiveBackend             │
│  JSON mailboxes on │              │  ├ ExtractEmailBridge    │
│  disk (JMAP-style) │              │  │  (spawns CLI, "API")  │
└────────────────────┘              │  └ SendEmailBridge       │
                                    │     (imports engine,     │
                                    │      "dependency")       │
                                    └──────────────────────────┘
```

## The EmailBackend interface

[`src/services/backend.ts`](../src/services/backend.ts) defines the single
contract both backends implement:

- `listMailboxes()` / `listMessages(mailboxId, limit)` / `getMessage(...)`
- `setKeyword(...)` - JMAP-style flags (`$seen`, `$flagged`, `$answered`)
- `deleteMessage(...)` - trash semantics (move first, permanent inside trash)
- `saveDraft(draft)` / `send(draft)`
- `refresh()` / `unreadCount()`

`send()` never throws; failures are returned as a `SendOutcome` so the UI can
present them inline. All other methods may throw, and the panel converts any
thrown error into a toast notice in the webview.

## Domain model

[`src/types.ts`](../src/types.ts) defines a simplified JMAP (RFC 8621) Email
shape used everywhere:

- `EmailEnvelope` - header-level data for list rows (no body).
- `EmailMessage` - envelope plus `bodyValues.text` / `bodyValues.html`.
- `EmailKeywords` - `$seen`, `$flagged`, `$draft`, `$answered`.
- `ComposeDraft` - raw composer input; address fields are parsed and
  validated by the backend, not the UI.

Both live bridges normalize their tool-specific formats into this model, so
the UI is unaware of which backend produced a message.

## Webview message protocol

The protocol is a discriminated union defined next to the domain model
(`WebviewToHostMessage`, `HostToWebviewMessage`), so the compiler checks
every case the panel handles.

| Direction | Message | Purpose |
| --- | --- | --- |
| webview → host | `ready` | Webview loaded; request initial state. |
| webview → host | `selectMailbox` | Load a mailbox's envelope list. |
| webview → host | `openMessage` | Load a full message (auto-marks `$seen`). |
| webview → host | `setKeyword` | Flag / unflag, mark read / unread. |
| webview → host | `deleteMessage` | Trash or permanently delete. |
| webview → host | `sendDraft` / `saveDraft` | Composer actions. |
| webview → host | `refresh` | Re-read the backend. |
| host → webview | `init` | Backend kind, mailboxes, active mailbox. |
| host → webview | `mailboxes` / `messageList` / `message` | State updates. |
| host → webview | `sendResult` / `draftSaved` | Composer outcomes. |
| host → webview | `notice` | Toast (info / warn / error). |
| host → webview | `compose` | Open the composer, optionally prefilled. |

## Security model

Email bodies are untrusted input. Two independent layers protect the webview:

1. **Sanitizer** ([`src/utils/sanitizeHtml.ts`](../src/utils/sanitizeHtml.ts))
   runs in the extension host before HTML reaches the webview. It removes
   script/style/iframe/object/embed/form/meta/base/link elements, HTML
   comments, inline event handlers, and scriptable URL schemes
   (`javascript:`, `vbscript:`, `data:text/html`).
2. **Content-Security-Policy** on the webview document: scripts only run with
   a per-load nonce, frames are forbidden, and images are restricted to
   bundled resources and `data:` URIs. Even if a pattern slipped past the
   sanitizer, the CSP prevents execution and remote loads.

Blocking remote images is intentional - it is the standard privacy default of
desktop mail clients (remote images enable read tracking).

Plain-text bodies are escaped and wrapped in a `<pre>` block, never parsed as
HTML. All other UI text (subjects, names, previews) is rendered via
`textContent`, so message data cannot inject markup into the panel.

## Backend lifecycle

`extension.ts` builds a backend from settings at activation and rebuilds it
whenever any `emailClient.*` setting changes; the open panel is handed the
new backend and reloads in place. The mock backend seeds its writable data
folder (VS Code global storage) from the bundled `mock-server/` fixtures on
first use, so the shipped samples stay pristine.

## Error philosophy

Live mode depends on two external tools that may be missing, unbuilt, or
misconfigured. Every failure path produces a specific, actionable message
(which path setting to fix, which build command to run) surfaced as a toast -
the panel itself never breaks. The mock backend is the always-works fallback,
and switching backends is one command.
