import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACCOUNTS_DIR, loadAccountConfigsFromRoot } from '../services/accountConfig';
import {
  SECRET_PLACEHOLDER,
  deleteAccount,
  mergeSecrets,
  saveAccount,
  toAccountInput,
  validateAccountName,
} from '../services/accountStore';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-client-store-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function readAccountFile(name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, ACCOUNTS_DIR, `${name}.json`), 'utf8'));
}

function findAccount(name: string) {
  return loadAccountConfigsFromRoot(root).accounts.find((a) => a.name === name);
}

describe('validateAccountName', () => {
  it('accepts filesystem-safe names', () => {
    assert.equal(validateAccountName('work'), undefined);
    assert.equal(validateAccountName('work-2.personal_x'), undefined);
  });

  it('rejects empty and unsafe names', () => {
    assert.match(validateAccountName('') ?? '', /required/);
    assert.match(validateAccountName('../escape') ?? '', /letters, numbers/);
    assert.match(validateAccountName('with space') ?? '', /letters, numbers/);
    assert.match(validateAccountName('-leading') ?? '', /letters, numbers/);
  });
});

describe('saveAccount', () => {
  it('writes the registry format wrapped by the account name', () => {
    saveAccount(root, {
      name: 'work',
      capability: 'both',
      imap: { host: 'imap.example.com', user: 'jane.doe@example.com', password: 'secret-a' },
      smtp: { host: 'smtp.example.com', user: 'jane.doe@example.com', pass: 'secret-b' },
    });
    const file = readAccountFile('work');
    assert.deepEqual(Object.keys(file), ['work']);
    assert.equal(file.work['extract-email'].imap.host, 'imap.example.com');
    assert.equal(file.work['send-email'].auth.user, 'jane.doe@example.com');
  });

  it('writes only the extract block for an extract-only account', () => {
    saveAccount(root, { name: 'reader', capability: 'extract-only', imap: { host: 'imap.example.com' } });
    const file = readAccountFile('reader');
    assert.ok(file.reader['extract-email']);
    assert.equal(file.reader['send-email'], undefined);
  });

  it('writes only the send block for a send-only account', () => {
    saveAccount(root, { name: 'outbound', capability: 'send-only', smtp: { host: 'smtp.example.com' } });
    const file = readAccountFile('outbound');
    assert.ok(file.outbound['send-email']);
    assert.equal(file.outbound['extract-email'], undefined);
  });

  it('applies sensible connection defaults', () => {
    saveAccount(root, { name: 'work', capability: 'both', imap: {}, smtp: {} });
    const file = readAccountFile('work');
    assert.equal(file.work['extract-email'].imap.port, 993);
    assert.equal(file.work['extract-email'].imap.tls, true);
    assert.equal(file.work['send-email'].port, 587);
    assert.equal(file.work['send-email'].secure, false);
  });

  it('rejects an invalid account name', () => {
    assert.throws(
      () => saveAccount(root, { name: '../escape', capability: 'both' }),
      /letters, numbers/
    );
  });

  it('produces a file the registry can read back', () => {
    saveAccount(root, {
      name: 'roundtrip',
      capability: 'both',
      imap: { host: 'imap.example.com', user: 'jane.doe@example.com' },
      smtp: { host: 'smtp.example.com', user: 'jane.doe@example.com' },
    });
    const account = findAccount('roundtrip');
    assert.ok(account);
    assert.equal(account.capability, 'both');
    assert.equal(account.email, 'jane.doe@example.com');
    assert.equal(account.editable, true);
  });

  it('removes the old file when an account is renamed', () => {
    saveAccount(root, { name: 'before', capability: 'both', imap: {}, smtp: {} });
    const previous = findAccount('before');
    assert.ok(previous);
    saveAccount(root, { name: 'after', capability: 'both', imap: {}, smtp: {} }, previous);
    assert.equal(fs.existsSync(path.join(root, ACCOUNTS_DIR, 'before.json')), false);
    assert.ok(findAccount('after'));
  });
});

describe('secret handling', () => {
  it('masks stored passwords in the editor view', () => {
    saveAccount(root, {
      name: 'work',
      capability: 'both',
      imap: { host: 'imap.example.com', password: 'imap-secret' },
      smtp: { host: 'smtp.example.com', pass: 'smtp-secret' },
    });
    const view = toAccountInput(findAccount('work')!);
    assert.equal(view.imap?.password, SECRET_PLACEHOLDER);
    assert.equal(view.smtp?.pass, SECRET_PLACEHOLDER);
    assert.equal(view.imap?.host, 'imap.example.com');
  });

  it('keeps the stored password when the sentinel comes back unchanged', () => {
    saveAccount(root, {
      name: 'work',
      capability: 'both',
      imap: { host: 'imap.example.com', password: 'imap-secret' },
      smtp: { host: 'smtp.example.com', pass: 'smtp-secret' },
    });
    const previous = findAccount('work')!;
    const merged = mergeSecrets(
      {
        name: 'work',
        capability: 'both',
        imap: { host: 'imap2.example.com', password: SECRET_PLACEHOLDER },
        smtp: { host: 'smtp.example.com', pass: SECRET_PLACEHOLDER },
      },
      previous
    );
    assert.equal(merged.imap?.password, 'imap-secret');
    assert.equal(merged.smtp?.pass, 'smtp-secret');

    saveAccount(root, merged, previous);
    const file = readAccountFile('work');
    assert.equal(file.work['extract-email'].imap.password, 'imap-secret');
    assert.equal(file.work['extract-email'].imap.host, 'imap2.example.com');
  });

  it('replaces the password when a new one is supplied', () => {
    saveAccount(root, { name: 'work', capability: 'both', imap: { password: 'old-secret' }, smtp: {} });
    const previous = findAccount('work')!;
    const merged = mergeSecrets(
      { name: 'work', capability: 'both', imap: { password: 'new-secret' }, smtp: {} },
      previous
    );
    assert.equal(merged.imap?.password, 'new-secret');
  });

  it('leaves input untouched when there is no previous account', () => {
    const input = { name: 'fresh', capability: 'both' as const, imap: { password: 'p' } };
    assert.equal(mergeSecrets(input).imap?.password, 'p');
  });
});

describe('deleteAccount', () => {
  it('removes every file that defines the account', () => {
    saveAccount(root, { name: 'work', capability: 'both', imap: {}, smtp: {} });
    const account = findAccount('work')!;
    deleteAccount(account);
    assert.equal(findAccount('work'), undefined);
    assert.equal(fs.existsSync(path.join(root, ACCOUNTS_DIR, 'work.json')), false);
  });
});

describe('account folders round-trip', () => {
  it('persists normalized folders and reads them back for editing', () => {
    saveAccount(root, {
      name: 'work',
      capability: 'both',
      imap: { host: 'imap.example.com' },
      smtp: { host: 'smtp.example.com' },
      folders: [' Sent ', 'Inbox', 'Trash', 'sent'],
    });
    assert.deepEqual(readAccountFile('work').work.folders, ['Sent', 'Trash']);
    const input = toAccountInput(findAccount('work')!);
    assert.deepEqual(input.folders, ['Sent', 'Trash']);
  });

  it('keeps folders across an edit that does not touch them', () => {
    saveAccount(root, {
      name: 'work',
      capability: 'both',
      imap: { host: 'imap.example.com' },
      smtp: {},
      folders: ['Sent'],
    });
    const previous = findAccount('work')!;
    const edited = { ...toAccountInput(previous), smtp: { host: 'smtp.example.com' } };
    saveAccount(root, mergeSecrets(edited, previous), previous);
    assert.deepEqual(readAccountFile('work').work.folders, ['Sent']);
  });

  it('drops folders for a send-only account', () => {
    saveAccount(root, {
      name: 'outbound',
      capability: 'send-only',
      smtp: { host: 'smtp.example.com' },
      folders: ['Sent'],
    });
    assert.equal(readAccountFile('outbound').outbound.folders, undefined);
  });
});
