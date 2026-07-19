import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACCOUNTS_FOLDER, accountLabel, loadAccounts } from '../services/accountManager';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-client-accounts-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAccountFile(id: string, content: string): string {
  const dir = path.join(root, ACCOUNTS_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('settings-source accounts', () => {
  it('loads valid entries and defaults the backend to mock', () => {
    const { accounts, warnings } = loadAccounts(
      [{ id: 'work', name: 'Work', email: 'jane.doe@example.com' }],
      []
    );
    assert.equal(warnings.length, 0);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].backend, 'mock');
    assert.equal(accounts[0].source, 'settings');
  });

  it('skips entries without an id and reports them', () => {
    const { accounts, warnings } = loadAccounts([{ name: 'No Id' }, null, 'text'], []);
    assert.equal(accounts.length, 0);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /missing "id"/);
  });

  it('rejects a non-array settings value', () => {
    const { accounts, warnings } = loadAccounts({ id: 'x' }, []);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /must be an array/);
  });

  it('skips unknown backends', () => {
    const { accounts, warnings } = loadAccounts([{ id: 'x', backend: 'imap' }], []);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /unknown backend "imap"/);
  });

  it('ignores wrongly typed fields with a warning but keeps the account', () => {
    const { accounts, warnings } = loadAccounts(
      [{ id: 'x', email: 42, messageLimit: 'many' }],
      []
    );
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].email, undefined);
    assert.equal(accounts[0].messageLimit, undefined);
    assert.equal(warnings.length, 2);
  });

  it('clamps messageLimit into the 1-500 range', () => {
    const { accounts } = loadAccounts(
      [
        { id: 'low', messageLimit: 0 },
        { id: 'high', messageLimit: 9000 },
      ],
      []
    );
    assert.equal(accounts.find((a) => a.id === 'low')?.messageLimit, 1);
    assert.equal(accounts.find((a) => a.id === 'high')?.messageLimit, 500);
  });
});

describe('folder-source accounts', () => {
  it('loads files from settings/accounts and takes the id from the file name', () => {
    writeAccountFile('personal', JSON.stringify({ name: 'Personal', backend: 'mock' }));
    const { accounts, warnings } = loadAccounts([], [root]);
    assert.equal(warnings.length, 0);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, 'personal');
    assert.equal(accounts[0].source, 'folder');
  });

  it('returns nothing when the folder does not exist', () => {
    const { accounts, warnings } = loadAccounts([], [root]);
    assert.equal(accounts.length, 0);
    assert.equal(warnings.length, 0);
  });

  it('reports invalid JSON and continues with other files', () => {
    writeAccountFile('broken', '{ not json');
    writeAccountFile('good', JSON.stringify({ backend: 'mock' }));
    const { accounts, warnings } = loadAccounts([], [root]);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, 'good');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /invalid JSON/);
  });

  it('rejects files whose content is not an object', () => {
    writeAccountFile('list', '[1, 2]');
    const { accounts, warnings } = loadAccounts([], [root]);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /expected a JSON object/);
  });

  it('loads live accounts with tool fields', () => {
    writeAccountFile(
      'acme-live',
      JSON.stringify({
        name: 'Acme Corp',
        backend: 'live',
        extractEmailPath: path.join(root, 'tools', 'extract-email'),
        sendEmailPath: path.join(root, 'tools', 'send-email'),
        toolAccount: 'example',
        messageLimit: 25,
      })
    );
    const { accounts } = loadAccounts([], [root]);
    assert.equal(accounts[0].backend, 'live');
    assert.equal(accounts[0].toolAccount, 'example');
    assert.equal(accounts[0].messageLimit, 25);
  });

  it('scans multiple workspace roots', () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'email-client-accounts-b-'));
    try {
      writeAccountFile('one', JSON.stringify({}));
      const dirB = path.join(second, ACCOUNTS_FOLDER);
      fs.mkdirSync(dirB, { recursive: true });
      fs.writeFileSync(path.join(dirB, 'two.json'), '{}', 'utf8');
      const { accounts } = loadAccounts([], [root, second]);
      assert.deepEqual(accounts.map((a) => a.id).sort(), ['one', 'two']);
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});

describe('merging', () => {
  it('lets a folder file override a settings entry with the same id', () => {
    writeAccountFile('work', JSON.stringify({ name: 'Work (local)', backend: 'mock' }));
    const { accounts } = loadAccounts(
      [{ id: 'work', name: 'Work (settings)', backend: 'live' }],
      [root]
    );
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].name, 'Work (local)');
    assert.equal(accounts[0].backend, 'mock');
    assert.equal(accounts[0].source, 'folder');
  });

  it('keeps distinct ids from both sources', () => {
    writeAccountFile('local-only', '{}');
    const { accounts } = loadAccounts([{ id: 'settings-only' }], [root]);
    assert.deepEqual(accounts.map((a) => a.id).sort(), ['local-only', 'settings-only']);
  });
});

describe('accountLabel', () => {
  it('prefers the name and falls back to the id', () => {
    assert.equal(accountLabel({ id: 'x', name: 'Nice Name', backend: 'mock', source: 'settings' }), 'Nice Name');
    assert.equal(accountLabel({ id: 'x', name: '  ', backend: 'mock', source: 'settings' }), 'x');
    assert.equal(accountLabel({ id: 'x', backend: 'mock', source: 'settings' }), 'x');
  });
});
