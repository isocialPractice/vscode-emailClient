/**
 * Account configuration registry.
 *
 * All accounts are stored as one-stop JSON files under the accounts/
 * folder at each registry root:
 *
 *   accounts/<name>.json   extraction AND/OR sending credentials
 *
 * Each file holds exactly one top-level property - the master property -
 * whose name matches the file base name. That property contains an
 * optional `extract-email` block (IMAP settings) and/or an optional
 * `send-email` block (SMTP settings).
 *
 * This module has no dependency on the `vscode` API so it can run under
 * plain Node in unit tests.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Registry folder, relative to a registry root. */
export const ACCOUNTS_DIR = 'accounts';

/** Keys used inside a one-stop account file. */
export const EXTRACT_BLOCK = 'extract-email';
export const SEND_BLOCK = 'send-email';

export type AccountCapability = 'extract-only' | 'send-only' | 'both';

export interface AccountSide {
  /** Account name passed to the companion tool. */
  toolAccount: string;
  /** Absolute path of the file that defines this side. */
  filePath: string;
  /** Registry location the side came from. */
  origin: 'accounts';
  /** Connection block, when it could be read (JSON sources only). */
  config?: Record<string, unknown>;
  /** True when the source is a native module that is not parsed. */
  nativeModule: boolean;
}

export interface ResolvedAccount {
  /** Account name = file base name = master property. */
  name: string;
  capability: AccountCapability;
  /** Identity address for display, when one could be determined. */
  email?: string;
  /** Extra IMAP folders (besides Inbox) shown for this account. */
  folders?: string[];
  /** Registry root this account was found under. */
  root: string;
  /** Every file that defines this account. */
  files: string[];
  /** True when the account is editable as structured JSON. */
  editable: boolean;
  extract?: AccountSide;
  send?: AccountSide;
}

export interface AllowFlags {
  extractOnly: boolean;
  sendOnly: boolean;
  both: boolean;
}

export interface AccountConfigResult {
  accounts: ResolvedAccount[];
  warnings: string[];
}

const ALLOW_ALL: AllowFlags = { extractOnly: true, sendOnly: true, both: true };

interface FoundFile {
  name: string;
  filePath: string;
  origin: string;
  /** Parsed content for `.json`; undefined for native modules. */
  raw?: Record<string, unknown>;
  nativeModule: boolean;
}

/**
 * Discover accounts under each registry root. When a name appears under
 * more than one root, the earlier root wins.
 */
export function loadAccountConfigs(
  roots: string[],
  allow: AllowFlags = ALLOW_ALL
): AccountConfigResult {
  const warnings: string[] = [];
  const byName = new Map<string, ResolvedAccount>();

  for (const root of roots) {
    const result = loadAccountConfigsFromRoot(root, allow);
    warnings.push(...result.warnings);
    for (const account of result.accounts) {
      if (byName.has(account.name)) {
        warnings.push(
          `Account "${account.name}" is defined under more than one root; using the first.`
        );
        continue;
      }
      byName.set(account.name, account);
    }
  }

  return { accounts: [...byName.values()], warnings };
}

/** Resolve accounts for a single registry root. */
export function loadAccountConfigsFromRoot(
  root: string,
  allow: AllowFlags = ALLOW_ALL
): AccountConfigResult {
  const warnings: string[] = [];

  const unified = readFolder(path.join(root, ACCOUNTS_DIR), ACCOUNTS_DIR, ['.json'], warnings);

  const accounts: ResolvedAccount[] = [];

  for (const name of [...unified.keys()].sort()) {
    const master = unified.get(name)!;
    let extract: AccountSide | undefined;
    let send: AccountSide | undefined;
    let email: string | undefined;

    const body = readMasterBody(master, name, warnings);
    if (!body) {
      continue;
    }

    const extractBlock = objectField(body, EXTRACT_BLOCK);
    const sendBlock = objectField(body, SEND_BLOCK);

    if (extractBlock) {
      extract = {
        toolAccount: name,
        filePath: master.filePath,
        origin: 'accounts',
        config: extractBlock,
        nativeModule: false,
      };
    }
    if (sendBlock) {
      send = {
        toolAccount: name,
        filePath: master.filePath,
        origin: 'accounts',
        config: sendBlock,
        nativeModule: false,
      };
    }
    if (!extractBlock && !sendBlock) {
      warnings.push(
        `${master.origin}/${path.basename(master.filePath)}: "${name}" has neither an ` +
          `"${EXTRACT_BLOCK}" nor a "${SEND_BLOCK}" block; account skipped.`
      );
      continue;
    }
    email = identityFromBlocks(extractBlock, sendBlock);

    // The documented spot for "folders" is the master level, but accept it
    // inside the extract-email block or its imap block too - that is where
    // hand-edited files tend to put it, next to the connection it belongs to.
    const imapBlock = extractBlock ? objectField(extractBlock, 'imap') : undefined;
    const folders = normalizeFolders(
      body.folders ?? extractBlock?.folders ?? imapBlock?.folders,
      warnings,
      `${ACCOUNTS_DIR}/${path.basename(master.filePath)}`
    );

    const capability = capabilityOf(extract, send);
    if (!capability) {
      continue;
    }
    if (!isAllowed(capability, allow)) {
      warnings.push(`Account "${name}" is ${capability}, which is not permitted; skipped.`);
      continue;
    }

    accounts.push({ name, capability, email, folders, root, files: [master.filePath], editable: true, extract, send });
  }

  return { accounts, warnings };
}

/**
 * Normalize a user-supplied folder list: strings only, trimmed, deduplicated
 * case-insensitively, and never containing the inbox (it is always shown).
 * Returns undefined when nothing valid remains, so callers can omit the
 * property entirely.
 */
export function normalizeFolders(
  value: unknown,
  warnings: string[],
  origin: string
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`${origin}: "folders" must be an array of folder names; value ignored.`);
    return undefined;
  }
  const seen = new Set<string>();
  const folders: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      warnings.push(`${origin}: "folders" entries must be strings; entry ignored.`);
      continue;
    }
    const name = entry.trim();
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (key === 'inbox' || seen.has(key)) {
      continue; // Inbox is always listed; duplicates add nothing.
    }
    seen.add(key);
    folders.push(name);
  }
  return folders.length > 0 ? folders : undefined;
}

export function capabilityLabel(capability: AccountCapability): string {
  switch (capability) {
    case 'both':
      return 'extract + send';
    case 'extract-only':
      return 'extract only';
    case 'send-only':
      return 'send only';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Rule 1: the file holds exactly one top-level property (the master
 * property) whose name matches the file name. Returns its value.
 */
function readMasterBody(
  file: FoundFile,
  name: string,
  warnings: string[]
): Record<string, unknown> | undefined {
  const raw = file.raw;
  const label = `${ACCOUNTS_DIR}/${path.basename(file.filePath)}`;
  if (!raw) {
    return undefined;
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    warnings.push(
      `${label}: expected exactly one top-level property named "${name}" ` +
        `(found ${keys.length}); account skipped.`
    );
    return undefined;
  }
  if (keys[0] !== name) {
    warnings.push(
      `${label}: master property "${keys[0]}" must match the file name "${name}"; account skipped.`
    );
    return undefined;
  }
  const body = raw[keys[0]];
  if (!isObject(body)) {
    warnings.push(`${label}: "${name}" must be an object; account skipped.`);
    return undefined;
  }
  return body;
}

/** Identity address from a one-stop file's blocks. */
function identityFromBlocks(
  extractBlock: Record<string, unknown> | undefined,
  sendBlock: Record<string, unknown> | undefined
): string | undefined {
  const imap = extractBlock ? objectField(extractBlock, 'imap') : undefined;
  const imapUser = imap ? stringField(imap, 'user') : undefined;
  if (imapUser) {
    return imapUser;
  }
  const auth = sendBlock ? objectField(sendBlock, 'auth') : undefined;
  return auth ? stringField(auth, 'user') : undefined;
}

function capabilityOf(
  extract: AccountSide | undefined,
  send: AccountSide | undefined
): AccountCapability | undefined {
  if (extract && send) {
    return 'both';
  }
  if (extract) {
    return 'extract-only';
  }
  if (send) {
    return 'send-only';
  }
  return undefined;
}

function isAllowed(capability: AccountCapability, allow: AllowFlags): boolean {
  return (
    (capability === 'both' && allow.both) ||
    (capability === 'extract-only' && allow.extractOnly) ||
    (capability === 'send-only' && allow.sendOnly)
  );
}

/**
 * Read account files from a folder, keyed by file base name. Template files
 * (`*.template`) are ignored so shipped examples never register as accounts.
 */
function readFolder(
  dir: string,
  originLabel: string,
  extensions: string[],
  warnings: string[]
): Map<string, FoundFile> {
  const result = new Map<string, FoundFile>();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return result; // Folder does not exist under this root.
  }

  for (const entry of entries.sort()) {
    const ext = path.extname(entry).toLowerCase();
    if (!extensions.includes(ext)) {
      continue; // Skips *.template and unrelated files.
    }
    const filePath = path.join(dir, entry);
    const name = path.basename(entry, path.extname(entry)).trim();
    if (!name) {
      continue;
    }
    if (result.has(name)) {
      warnings.push(
        `${originLabel}: more than one file named "${name}"; using ${result.get(name)!.filePath}.`
      );
      continue;
    }

    if (ext === '.json') {
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        warnings.push(
          `${originLabel}/${entry}: invalid JSON (${
            err instanceof Error ? err.message : String(err)
          }); file skipped.`
        );
        continue;
      }
      if (!isObject(raw)) {
        warnings.push(`${originLabel}/${entry}: expected a JSON object; file skipped.`);
        continue;
      }
      result.set(name, { name, filePath, origin: originLabel, raw, nativeModule: false });
    } else {
      // Native tool module: registered by name, never executed.
      result.set(name, { name, filePath, origin: originLabel, nativeModule: true });
    }
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectField(
  raw: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = raw[key];
  return isObject(value) ? value : undefined;
}
