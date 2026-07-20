/**
 * Account discovery and merging.
 *
 * Accounts are named profiles that bundle a backend choice with its
 * configuration (mock data folder, or live tool paths). They come from two
 * sources:
 *
 * 1. The `emailClient.accounts` array in VS Code settings (user or
 *    workspace scope; VS Code's own precedence applies between scopes).
 * 2. JSON files in a `settings/accounts/` folder at the root of each
 *    workspace folder - one file per account, the file name (without
 *    `.json`) is the account id. Folder files typically hold private,
 *    machine-specific configuration and belong in `.gitignore`.
 *
 * When both sources define the same id, the folder file wins (it is the
 * more specific, local source). This module has no dependency on the
 * `vscode` API so it can run under plain Node in unit tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeFolders } from './accountConfig';

export interface EmailAccountConfig {
  /** Unique id; settings entries declare it, folder files take the file name. */
  id: string;
  /** Display name shown in the account picker and panel badge. */
  name?: string;
  /** Identity address; the mock backend sends from it when present. */
  email?: string;
  backend: 'mock' | 'live';
  /** Mock backend: data folder override (empty uses the per-user default). */
  mockDataPath?: string;
  /** Live backend: local tool installations. */
  extractEmailPath?: string;
  sendEmailPath?: string;
  /** Account name understood inside the extract-email / send-email tools. */
  toolAccount?: string;
  /** Live backend: extra IMAP folders (besides Inbox) to list. */
  folders?: string[];
  messageLimit?: number;
  /** Where this account was defined. */
  source: 'settings' | 'folder';
}

export interface AccountLoadResult {
  accounts: EmailAccountConfig[];
  warnings: string[];
}

/** Sub-path checked inside each workspace folder root. */
export const ACCOUNTS_FOLDER = path.join('settings', 'accounts');

/**
 * Load and merge accounts from the settings array and from
 * `settings/accounts/*.json` under each of `folderRoots`.
 */
export function loadAccounts(
  settingsAccounts: unknown,
  folderRoots: string[]
): AccountLoadResult {
  const warnings: string[] = [];
  const byId = new Map<string, EmailAccountConfig>();

  if (Array.isArray(settingsAccounts)) {
    settingsAccounts.forEach((entry, index) => {
      const raw = entry as Record<string, unknown> | null;
      const id = raw && typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id) {
        warnings.push(`emailClient.accounts[${index}]: missing "id"; entry skipped.`);
        return;
      }
      const account = normalizeAccount(raw!, id, 'settings', warnings, `emailClient.accounts[${index}]`);
      if (account) {
        byId.set(id, account);
      }
    });
  } else if (settingsAccounts !== undefined && settingsAccounts !== null) {
    warnings.push('emailClient.accounts must be an array; value ignored.');
  }

  for (const root of folderRoots) {
    const dir = path.join(root, ACCOUNTS_FOLDER);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
    } catch {
      continue; // No settings/accounts folder in this root.
    }
    for (const file of files.sort()) {
      const filePath = path.join(dir, file);
      const id = path.basename(file, path.extname(file)).trim();
      if (!id) {
        warnings.push(`${filePath}: empty account id; file skipped.`);
        continue;
      }
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        warnings.push(
          `${filePath}: invalid JSON (${err instanceof Error ? err.message : String(err)}); file skipped.`
        );
        continue;
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        warnings.push(`${filePath}: expected a JSON object; file skipped.`);
        continue;
      }
      const account = normalizeAccount(raw, id, 'folder', warnings, filePath);
      if (account) {
        byId.set(id, account); // Folder source overrides a settings entry with the same id.
      }
    }
  }

  return { accounts: [...byId.values()], warnings };
}

export function accountLabel(account: EmailAccountConfig): string {
  return account.name?.trim() || account.id;
}

function normalizeAccount(
  raw: Record<string, unknown>,
  id: string,
  source: 'settings' | 'folder',
  warnings: string[],
  origin: string
): EmailAccountConfig | undefined {
  const backendRaw = raw.backend ?? 'mock';
  if (backendRaw !== 'mock' && backendRaw !== 'live') {
    warnings.push(`${origin}: unknown backend "${String(backendRaw)}"; account skipped.`);
    return undefined;
  }

  const account: EmailAccountConfig = { id, backend: backendRaw, source };

  const str = (key: 'name' | 'email' | 'mockDataPath' | 'extractEmailPath' | 'sendEmailPath' | 'toolAccount') => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
      account[key] = value.trim();
    } else if (value !== undefined && typeof value !== 'string') {
      warnings.push(`${origin}: "${key}" must be a string; value ignored.`);
    }
  };
  str('name');
  str('email');
  str('mockDataPath');
  str('extractEmailPath');
  str('sendEmailPath');
  str('toolAccount');

  const folders = normalizeFolders(raw.folders, warnings, origin);
  if (folders) {
    account.folders = folders;
  }

  const limit = raw.messageLimit;
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    account.messageLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  } else if (limit !== undefined) {
    warnings.push(`${origin}: "messageLimit" must be a number; value ignored.`);
  }

  return account;
}
