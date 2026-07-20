import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { LiveBackend } from '../services/liveBackend';

// A path that exists nowhere; bridges must fail with a clear message, never hang.
const MISSING_TOOL = path.join(os.tmpdir(), 'email-client-missing-tool');

function sendOnlyBackend(): LiveBackend {
  return new LiveBackend({
    extractEmailPath: '',
    sendEmailPath: MISSING_TOOL,
    messageLimit: 50,
  });
}

describe('send-only live accounts', () => {
  it('labels the backend as send only', () => {
    assert.match(sendOnlyBackend().label, /send only/);
  });

  it('presents an empty inbox instead of an error', async () => {
    const backend = sendOnlyBackend();
    const mailboxes = await backend.listMailboxes();
    assert.equal(mailboxes.length, 1);
    assert.equal(mailboxes[0].role, 'inbox');
    assert.equal(mailboxes[0].totalCount, 0);
    assert.match(mailboxes[0].name, /send only/i);
    assert.deepEqual(await backend.listMessages('inbox'), []);
    assert.equal(await backend.getMessage('inbox', 'any'), undefined);
    assert.equal(await backend.unreadCount(), 0);
  });

  it('treats read-side mutations and refresh as no-ops', async () => {
    const backend = sendOnlyBackend();
    await backend.setKeyword('inbox', 'any', '$seen', true);
    await backend.deleteMessage('inbox', 'any');
    await backend.refresh();
  });

  it('still routes send attempts to the send bridge', async () => {
    const outcome = await sendOnlyBackend().send({
      to: 'jane.doe@example.com',
      subject: 'Hello',
      body: 'Hi',
    });
    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? '', /send-email engine not found/);
  });
});

describe('extract-only live accounts', () => {
  function extractOnlyBackend(): LiveBackend {
    return new LiveBackend({
      extractEmailPath: MISSING_TOOL,
      sendEmailPath: '',
      capability: 'extract-only',
      messageLimit: 50,
    });
  }

  it('labels the backend as extract only', () => {
    assert.match(extractOnlyBackend().label, /extract only/);
  });

  it('refuses to send with a capability-specific message', async () => {
    const outcome = await extractOnlyBackend().send({
      to: 'jane.doe@example.com',
      subject: 'Hello',
      body: 'Hi',
    });
    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? '', /extract-only/);
  });

  it('attempts extraction (failing clearly when the tool is missing)', async () => {
    await assert.rejects(() => extractOnlyBackend().listMessages('inbox'), /exited with code|ENOENT|not/);
  });
});

describe('capability overrides inferred paths', () => {
  it('send-only capability ignores a configured extract path', async () => {
    const backend = new LiveBackend({
      extractEmailPath: MISSING_TOOL,
      sendEmailPath: MISSING_TOOL,
      capability: 'send-only',
      messageLimit: 50,
    });
    assert.match(backend.label, /send only/);
    const mailboxes = await backend.listMailboxes();
    assert.equal(mailboxes[0].totalCount, 0);
    assert.deepEqual(await backend.listMessages('inbox'), []);
  });
});

describe('unconfigured live accounts', () => {
  it('reports the missing extraction path when nothing is configured', async () => {
    const backend = new LiveBackend({ extractEmailPath: '', sendEmailPath: '', messageLimit: 50 });
    await assert.rejects(() => backend.listMailboxes(), /extractEmailPath/);
    const outcome = await backend.send({ to: 'jane.doe@example.com', subject: 'x', body: 'x' });
    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? '', /sendEmailPath/);
  });

  it('rejects drafts in live mode', async () => {
    const backend = sendOnlyBackend();
    await assert.rejects(
      () => backend.saveDraft({ to: '', subject: '', body: '' }),
      /mock backend/
    );
  });
});

describe('account folders', () => {
  it('infers roles from common folder names', async () => {
    const { folderRole } = await import('../services/liveBackend');
    assert.equal(folderRole('Sent'), 'sent');
    assert.equal(folderRole('Sent Items'), 'sent');
    assert.equal(folderRole('sent mail'), 'sent');
    assert.equal(folderRole('Drafts'), 'drafts');
    assert.equal(folderRole('Trash'), 'trash');
    assert.equal(folderRole('Deleted Items'), 'trash');
    assert.equal(folderRole('Bin'), 'trash');
    assert.equal(folderRole('Archive'), 'archive');
    assert.equal(folderRole('All Mail'), 'archive');
    assert.equal(folderRole('Receipts'), 'custom');
  });

  it('keeps a send-only account to its placeholder inbox even with folders', async () => {
    const backend = new LiveBackend({
      extractEmailPath: '',
      sendEmailPath: MISSING_TOOL,
      folders: ['Sent', 'Trash'],
      messageLimit: 50,
    });
    const mailboxes = await backend.listMailboxes();
    assert.equal(mailboxes.length, 1);
    assert.equal(mailboxes[0].role, 'inbox');
  });

  it('returns nothing for an unknown mailbox id without spawning the CLI', async () => {
    const backend = new LiveBackend({
      extractEmailPath: MISSING_TOOL,
      sendEmailPath: '',
      capability: 'extract-only',
      folders: ['Sent'],
      messageLimit: 50,
    });
    assert.deepEqual(await backend.listMessages('folder:nonexistent'), []);
  });

  it('routes a known folder mailbox to extraction (failing clearly without the tool)', async () => {
    const backend = new LiveBackend({
      extractEmailPath: MISSING_TOOL,
      sendEmailPath: '',
      capability: 'extract-only',
      folders: ['Sent'],
      messageLimit: 50,
    });
    await assert.rejects(
      () => backend.listMessages('folder:sent'),
      /exited with code|ENOENT|not/
    );
  });

  it('treats deletion inside a trash folder as session-local (no CLI call)', async () => {
    const backend = new LiveBackend({
      extractEmailPath: MISSING_TOOL,
      sendEmailPath: '',
      capability: 'extract-only',
      folders: ['Trash'],
      messageLimit: 50,
    });
    // Resolves without touching the missing tool: trash deletions are local.
    await backend.deleteMessage('folder:trash', 'live-0-2026-01-01');
  });
});
