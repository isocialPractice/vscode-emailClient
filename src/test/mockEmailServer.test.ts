import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MOCK_BOUNCE_ADDRESS, MockEmailServer } from '../services/mockEmailServer';

// Bundled sample data lives at <repo>/mock-server; tests run from dist/test.
const FIXTURES = path.resolve(__dirname, '..', '..', 'mock-server');

let workDir: string;
let server: MockEmailServer;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-client-test-'));
  MockEmailServer.seed(FIXTURES, workDir);
  server = new MockEmailServer(workDir);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('MockEmailServer.seed', () => {
  it('copies fixtures only when the target is empty', () => {
    const marker = path.join(workDir, 'mailboxes', 'inbox.json');
    fs.writeFileSync(marker, '{"id":"inbox","name":"X","role":"inbox","sortOrder":1,"emails":[]}');
    MockEmailServer.seed(FIXTURES, workDir);
    const kept = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(kept.name, 'X');
  });

  it('force re-seeds over existing data', () => {
    const marker = path.join(workDir, 'mailboxes', 'inbox.json');
    fs.writeFileSync(marker, '{"id":"inbox","name":"X","role":"inbox","sortOrder":1,"emails":[]}');
    MockEmailServer.seed(FIXTURES, workDir, true);
    const reset = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(reset.name, 'Inbox');
  });
});

describe('mailboxes and messages', () => {
  it('lists mailboxes sorted with counts', async () => {
    const mailboxes = await server.listMailboxes();
    assert.deepEqual(
      mailboxes.map((m) => m.id),
      ['inbox', 'sent', 'drafts', 'archive', 'trash']
    );
    const inbox = mailboxes[0];
    assert.equal(inbox.role, 'inbox');
    assert.ok(inbox.totalCount >= 7);
    assert.ok(inbox.unreadCount >= 3);
  });

  it('lists envelopes newest first without bodies', async () => {
    const messages = await server.listMessages('inbox');
    assert.ok(messages.length >= 2);
    for (let i = 1; i < messages.length; i++) {
      assert.ok(messages[i - 1].receivedAt >= messages[i].receivedAt);
    }
    assert.equal('bodyValues' in messages[0], false);
  });

  it('respects the message limit', async () => {
    const messages = await server.listMessages('inbox', 2);
    assert.equal(messages.length, 2);
  });

  it('returns a full message with body', async () => {
    const message = await server.getMessage('inbox', 'eml-1002');
    assert.ok(message);
    assert.ok(message.bodyValues.text?.includes('billing statement'));
  });
});

describe('keywords', () => {
  it('persists $seen across instances', async () => {
    await server.setKeyword('inbox', 'eml-1001', '$seen', true);
    const reopened = new MockEmailServer(workDir);
    const message = await reopened.getMessage('inbox', 'eml-1001');
    assert.equal(message?.keywords.$seen, true);
  });

  it('tracks the inbox unread count', async () => {
    const before = await server.unreadCount();
    await server.setKeyword('inbox', 'eml-1001', '$seen', true);
    assert.equal(await server.unreadCount(), before - 1);
  });
});

describe('delete semantics', () => {
  it('moves a message to trash first', async () => {
    await server.deleteMessage('inbox', 'eml-1006');
    assert.equal(await server.getMessage('inbox', 'eml-1006'), undefined);
    const inTrash = await server.getMessage('trash', 'eml-1006');
    assert.ok(inTrash);
    assert.equal(inTrash.mailboxId, 'trash');
  });

  it('deletes permanently from trash', async () => {
    await server.deleteMessage('inbox', 'eml-1006');
    await server.deleteMessage('trash', 'eml-1006');
    assert.equal(await server.getMessage('trash', 'eml-1006'), undefined);
  });
});

describe('send', () => {
  it('appends a sent message and reports success', async () => {
    const outcome = await server.send({
      to: 'Jane Doe <jane.doe@example.com>',
      subject: 'Hello',
      body: 'Hello from the test suite.',
    });
    assert.equal(outcome.success, true);
    assert.ok(outcome.messageId);
    const sent = await server.getMessage('sent', outcome.messageId!);
    assert.ok(sent);
    assert.equal(sent.to[0].email, 'jane.doe@example.com');
    assert.equal(sent.bodyValues.text, 'Hello from the test suite.');
  });

  it('rejects a missing recipient', async () => {
    const outcome = await server.send({ to: '', subject: 'x', body: 'x' });
    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? '', /recipient/i);
  });

  it('rejects invalid addresses by name', async () => {
    const outcome = await server.send({ to: 'not-an-address', subject: 'x', body: 'x' });
    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? '', /not-an-address/);
  });

  it('simulates a bounce for the designated address', async () => {
    const outcome = await server.send({ to: MOCK_BOUNCE_ADDRESS, subject: 'x', body: 'x' });
    assert.equal(outcome.success, false);
    assert.match(outcome.error ?? '', /bounce/i);
  });

  it('consumes the stored draft it was sent from', async () => {
    const draftId = await server.saveDraft({
      to: 'bob@example.org',
      subject: 'Draft to send',
      body: 'Body',
    });
    const outcome = await server.send({
      id: draftId,
      to: 'bob@example.org',
      subject: 'Draft to send',
      body: 'Body',
    });
    assert.equal(outcome.success, true);
    assert.equal(await server.getMessage('drafts', draftId), undefined);
  });

  it('marks the original message answered on reply', async () => {
    const outcome = await server.send({
      to: 'alice@example.com',
      subject: 'Re: Lunch on Friday?',
      body: 'Count me in.',
      inReplyToId: 'eml-1006',
    });
    assert.equal(outcome.success, true);
    const original = await server.getMessage('inbox', 'eml-1006');
    assert.equal(original?.keywords.$answered, true);
  });
});

describe('drafts', () => {
  it('updates an existing draft in place', async () => {
    const first = await server.saveDraft({ to: 'bob@example.org', subject: 'v1', body: 'one' });
    const second = await server.saveDraft({
      id: first,
      to: 'bob@example.org',
      subject: 'v2',
      body: 'two',
    });
    assert.equal(await server.getMessage('drafts', first), undefined);
    const updated = await server.getMessage('drafts', second);
    assert.equal(updated?.subject, 'v2');
  });
});

describe('refresh', () => {
  it('re-reads state from disk', async () => {
    const file = path.join(workDir, 'mailboxes', 'inbox.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.emails = data.emails.slice(0, 1);
    fs.writeFileSync(file, JSON.stringify(data));
    await server.refresh();
    const messages = await server.listMessages('inbox');
    assert.equal(messages.length, 1);
  });
});
