# Testing

## Running the tests

```bash
npm test
```

This compiles the TypeScript sources (`pretest` runs the build) and executes
the unit suites with Node's built-in test runner - no VS Code download, no
extra test framework, no network access. Expected output ends with:

```text
# pass 35
# fail 0
```

Run a single suite directly:

```bash
node --test dist/test/mockEmailServer.test.js
```

## What is covered

| Suite | Focus |
| --- | --- |
| `mockEmailServer.test.ts` | The mock server end to end: seeding (fresh, idempotent, forced), mailbox listing and ordering, envelope/body separation, message limits, keyword persistence across instances, unread counting, trash semantics (move then permanent delete), send validation, simulated bounce, draft consumption on send, `$answered` on reply, draft upsert, and disk refresh. |
| `address.test.ts` | Address parsing (`bare`, `Name <addr>`, quoted names with commas), validation, invalid-entry reporting, and round-trip formatting. |
| `sanitizeHtml.test.ts` | Removal of scripts, frames, objects, forms, style blocks, comments, inline event handlers, and `javascript:` URLs; preservation of benign markup; text-to-HTML escaping. |

## Design for testability

The backend layer (`src/services/`) and utilities (`src/utils/`) never import
the `vscode` module, so they run under plain Node. VS Code-specific behavior
(commands, settings, the webview) lives in `src/extension.ts` and
`src/panel/`, which are exercised manually via `F5`.

Mock server tests copy the bundled fixtures into a fresh temporary folder
per test (`fs.mkdtemp`) and delete it afterwards, so tests are isolated,
order-independent, and never touch the shipped sample data.

## Adding a test

1. Create `src/test/<name>.test.ts` using `node:test` and `node:assert`:

   ```typescript
   import { strict as assert } from 'node:assert';
   import { describe, it } from 'node:test';

   describe('feature', () => {
     it('behaves', () => {
       assert.equal(1 + 1, 2);
     });
   });
   ```

2. Add the compiled file to the `test` script in `package.json`
   (`dist/test/<name>.test.js`). The explicit file list keeps the command
   portable across Node versions and shells.

3. `npm test`.

## Manual verification checklist

For changes touching the panel or webview (not covered by unit tests):

- `F5` → **Email Client: Open** - three panes render, inbox selected,
  unread rows bold, status bar counter matches.
- Open an unread message - it becomes read everywhere (row, sidebar pill,
  status bar).
- Reply → Send - toast confirms, message appears in Sent.
- Send to `bounce@example.com` - error toast, composer stays open.
- Delete from Inbox, then from Trash - moved, then gone.
- Toggle light/dark theme - the panel follows it.
- Tab through the toolbar, list, and composer - focus is always visible.
