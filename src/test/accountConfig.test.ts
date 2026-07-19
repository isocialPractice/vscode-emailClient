import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ACCOUNTS_DIR,
  capabilityLabel,
  loadAccountConfigsFromRoot,
} from '../services/accountConfig';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-client-registry-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(dir: string, fileName: string, body: unknown): string {
  const folder = path.join(root, dir);
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, fileName);
  fs.writeFileSync(filePath, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return filePath;
}

/** A one-stop account in the registry format: wrapped by the account name. */
function oneStop(name: string, options: { extract?: boolean; send?: boolean } = {}) {
  const body: Record<string, unknown> = {};
  if (options.extract !== false) {
    body['extract-email'] = {
      imap: {
        user: 'jane.doe@example.com',
        password: 'app-password-here',
        host: 'imap.example.com',
        port: 993,
        tls: true,
      },
    };
  }
  if (options.send !== false) {
    body['send-email'] = {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'jane.doe@example.com', pass: 'app-password-here' },
    };
  }
  return { [name]: body };
}

describe('one-stop accounts', () => {
  it('resolves a name-wrapped file with both blocks as both', () => {
    write(ACCOUNTS_DIR, 'work.json', oneStop('work'));
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.equal(warnings.length, 0);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].name, 'work');
    assert.equal(accounts[0].capability, 'both');
    assert.equal(accounts[0].editable, true);
    assert.equal(accounts[0].email, 'jane.doe@example.com');
  });

  it('reads the extract-email and send-email connection blocks', () => {
    write(ACCOUNTS_DIR, 'work.json', oneStop('work'));
    const { accounts } = loadAccountConfigsFromRoot(root);
    const imap = accounts[0].extract?.config?.imap as Record<string, unknown>;
    assert.equal(imap.host, 'imap.example.com');
    assert.equal(accounts[0].send?.config?.host, 'smtp.example.com');
  });

  it('is extract-only with just an extract-email block', () => {
    write(ACCOUNTS_DIR, 'reader.json', oneStop('reader', { send: false }));
    const { accounts } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts[0].capability, 'extract-only');
  });

  it('is send-only with just a send-email block', () => {
    write(ACCOUNTS_DIR, 'outbound.json', oneStop('outbound', { extract: false }));
    const { accounts } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts[0].capability, 'send-only');
  });
});

describe('master property rule', () => {
  it('skips a file whose top-level property does not match the file name', () => {
    write(ACCOUNTS_DIR, 'work.json', oneStop('personal'));
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /master property "personal" must match the file name "work"/);
  });

  it('skips a file with more than one top-level property', () => {
    write(ACCOUNTS_DIR, 'work.json', { work: {}, extra: {} });
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /exactly one top-level property/);
  });

  it('skips a file with neither an extract-email nor send-email block', () => {
    write(ACCOUNTS_DIR, 'work.json', { work: { note: 'nothing useful' } });
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /neither an "extract-email" nor a "send-email" block/);
  });

  it('skips a file whose master property is not an object', () => {
    write(ACCOUNTS_DIR, 'work.json', { work: 'oops' });
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts.length, 0);
    assert.match(warnings[0], /must be an object/);
  });
});

describe('split tool-module folders', () => {
  it('ignores template files in the accounts folder', () => {
    write(ACCOUNTS_DIR, 'example.json.template', '{}');
    const { accounts } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts.length, 0);
  });
});

describe('priority rule', () => {
  it('keeps distinct names from the accounts folder', () => {
    write(ACCOUNTS_DIR, 'work.json', oneStop('work'));
    write(ACCOUNTS_DIR, 'personal.json', oneStop('personal', { send: false }));
    const { accounts } = loadAccountConfigsFromRoot(root);
    assert.deepEqual(accounts.map((a) => a.name), ['personal', 'work']);
  });
});

describe('allow flags', () => {
  it('skips capabilities that are not permitted', () => {
    write(ACCOUNTS_DIR, 'reader.json', oneStop('reader', { send: false }));
    write(ACCOUNTS_DIR, 'unified.json', oneStop('unified'));
    const { accounts, warnings } = loadAccountConfigsFromRoot(root, {
      extractOnly: false,
      sendOnly: true,
      both: true,
    });
    assert.deepEqual(accounts.map((a) => a.name), ['unified']);
    assert.ok(warnings.some((w) => /extract-only, which is not permitted/.test(w)));
  });
});

describe('malformed files', () => {
  it('reports invalid JSON and continues', () => {
    write(ACCOUNTS_DIR, 'broken.json', '{ not json');
    write(ACCOUNTS_DIR, 'good.json', oneStop('good'));
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.deepEqual(accounts.map((a) => a.name), ['good']);
    assert.ok(warnings.some((w) => /invalid JSON/.test(w)));
  });

  it('returns nothing when no folders exist', () => {
    const { accounts, warnings } = loadAccountConfigsFromRoot(root);
    assert.equal(accounts.length, 0);
    assert.equal(warnings.length, 0);
  });
});

describe('capabilityLabel', () => {
  it('renders human-readable capability names', () => {
    assert.equal(capabilityLabel('both'), 'extract + send');
    assert.equal(capabilityLabel('extract-only'), 'extract only');
    assert.equal(capabilityLabel('send-only'), 'send only');
  });
});
