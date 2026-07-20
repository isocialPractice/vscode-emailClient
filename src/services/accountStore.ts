/**
 * Account file writes for the Manage Accounts UI.
 *
 * Structured accounts are written as one-stop `accounts/<name>.json` files
 * in the registry format: a single top-level property named after the file,
 * containing an `extract-email` and/or `send-email` block.
 *
 * Native tool modules (`.mjs` / `.js`) are never rewritten - they can only
 * be deleted or opened for manual editing.
 *
 * This module has no dependency on the `vscode` API so it can run under
 * plain Node in unit tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ACCOUNTS_DIR,
  AccountCapability,
  EXTRACT_BLOCK,
  ResolvedAccount,
  SEND_BLOCK,
  normalizeFolders,
} from './accountConfig';

/** Connection fields the editor collects for the extraction side. */
export interface ImapInput {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  tls?: boolean;
  authTimeout?: number;
}

/** Connection fields the editor collects for the sending side. */
export interface SmtpInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}

export interface AccountInput {
  name: string;
  capability: AccountCapability;
  imap?: ImapInput;
  smtp?: SmtpInput;
  /** Extra IMAP folders (besides Inbox) to list for this account. */
  folders?: string[];
}

/** Account names become file names, so keep them filesystem-safe. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateAccountName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Account name is required.';
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return 'Use letters, numbers, dot, dash, or underscore (starting with a letter or number).';
  }
  return undefined;
}

export function accountFilePath(root: string, name: string): string {
  return path.join(root, ACCOUNTS_DIR, `${name}.json`);
}

/**
 * Write an account as a one-stop JSON file. When `previous` is given and
 * the account was renamed, its old files are removed after the new file is
 * written successfully.
 */
export function saveAccount(
  root: string,
  input: AccountInput,
  previous?: ResolvedAccount
): string {
  const invalid = validateAccountName(input.name);
  if (invalid) {
    throw new Error(invalid);
  }
  const name = input.name.trim();

  const body: Record<string, unknown> = {};
  if (input.capability !== 'send-only') {
    body[EXTRACT_BLOCK] = { imap: cleanImap(input.imap ?? {}) };
  }
  if (input.capability !== 'extract-only') {
    body[SEND_BLOCK] = cleanSmtp(input.smtp ?? {});
  }
  if (Object.keys(body).length === 0) {
    throw new Error('An account must configure extraction, sending, or both.');
  }
  // Folders only matter when the account can extract; a send-only account
  // has no folder list to read.
  if (input.capability !== 'send-only') {
    const folders = normalizeFolders(input.folders, [], `${ACCOUNTS_DIR}/${name}.json`);
    if (folders) {
      body.folders = folders;
    }
  }

  const filePath = accountFilePath(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ [name]: body }, null, 2) + '\n', 'utf8');

  // A rename leaves the old definition behind; remove it.
  if (previous) {
    for (const stale of previous.files) {
      if (path.resolve(stale) !== path.resolve(filePath)) {
        try {
          fs.rmSync(stale, { force: true });
        } catch {
          // Leave unreadable files alone; the account list will show them.
        }
      }
    }
  }

  return filePath;
}

/** Remove every file that defines an account. */
export function deleteAccount(account: ResolvedAccount): void {
  for (const file of account.files) {
    fs.rmSync(file, { force: true });
  }
}

/** Editor-ready view of an account, with secrets replaced by a sentinel. */
export const SECRET_PLACEHOLDER = '__unchanged__';

export function toAccountInput(account: ResolvedAccount): AccountInput {
  const imapBlock = readObject(account.extract?.config, 'imap') ?? account.extract?.config;
  const sendBlock = account.send?.config;
  const authBlock = readObject(sendBlock, 'auth');

  return {
    name: account.name,
    capability: account.capability,
    folders: account.folders,
    imap: {
      host: readString(imapBlock, 'host'),
      port: readNumber(imapBlock, 'port'),
      user: readString(imapBlock, 'user'),
      password: readString(imapBlock, 'password') ? SECRET_PLACEHOLDER : undefined,
      tls: readBoolean(imapBlock, 'tls'),
      authTimeout: readNumber(imapBlock, 'authTimeout'),
    },
    smtp: {
      host: readString(sendBlock, 'host'),
      port: readNumber(sendBlock, 'port'),
      secure: readBoolean(sendBlock, 'secure'),
      user: readString(authBlock, 'user'),
      pass: readString(authBlock, 'pass') ? SECRET_PLACEHOLDER : undefined,
    },
  };
}

/**
 * Replace the secret sentinel with the value already on disk, so saving an
 * account without retyping its password keeps the stored one.
 */
export function mergeSecrets(input: AccountInput, previous?: ResolvedAccount): AccountInput {
  if (!previous) {
    return input;
  }
  const stored = toStoredSecrets(previous);
  const merged: AccountInput = { ...input, imap: { ...input.imap }, smtp: { ...input.smtp } };
  if (merged.imap?.password === SECRET_PLACEHOLDER) {
    merged.imap.password = stored.imapPassword;
  }
  if (merged.smtp?.pass === SECRET_PLACEHOLDER) {
    merged.smtp.pass = stored.smtpPass;
  }
  return merged;
}

function toStoredSecrets(account: ResolvedAccount): {
  imapPassword?: string;
  smtpPass?: string;
} {
  const imapBlock = readObject(account.extract?.config, 'imap') ?? account.extract?.config;
  const authBlock = readObject(account.send?.config, 'auth');
  return {
    imapPassword: readString(imapBlock, 'password'),
    smtpPass: readString(authBlock, 'pass'),
  };
}

// ── Shaping ──────────────────────────────────────────────────────────────

function cleanImap(imap: ImapInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  assign(out, 'user', imap.user);
  assign(out, 'password', imap.password);
  assign(out, 'host', imap.host);
  assign(out, 'port', imap.port ?? 993);
  out.tls = imap.tls ?? true;
  assign(out, 'authTimeout', imap.authTimeout ?? 3000);
  return out;
}

function cleanSmtp(smtp: SmtpInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  assign(out, 'host', smtp.host);
  assign(out, 'port', smtp.port ?? 587);
  out.secure = smtp.secure ?? false;
  const auth: Record<string, unknown> = {};
  assign(auth, 'user', smtp.user);
  assign(auth, 'pass', smtp.pass);
  if (Object.keys(auth).length > 0) {
    out.auth = auth;
  }
  return out;
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function readObject(
  source: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = source?.[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(
  source: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = source?.[key];
  return typeof value === 'boolean' ? value : undefined;
}
