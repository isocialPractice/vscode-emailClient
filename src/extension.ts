/**
 * Extension entry point: wires settings and account profiles to a backend
 * instance, registers commands, and keeps the status bar unread counter
 * current.
 *
 * Backend selection order:
 * 1. When `emailClient.activeAccount` names a discovered account profile,
 *    that profile decides the backend and its configuration.
 * 2. Otherwise the flat `emailClient.*` settings apply (the original,
 *    account-less behavior).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { EmailBackend } from './services/backend';
import { LiveBackend } from './services/liveBackend';
import { MockEmailServer } from './services/mockEmailServer';
import {
  AccountLoadResult,
  EmailAccountConfig,
  accountLabel,
  loadAccounts,
} from './services/accountManager';
import {
  AccountConfigResult,
  ResolvedAccount,
  capabilityLabel,
  loadAccountConfigs,
} from './services/accountConfig';
import { EmailClientPanel } from './panel/emailClientPanel';
import { AccountsPanel } from './panel/accountsPanel';

let statusBarItem: vscode.StatusBarItem;
let backend: EmailBackend;
const shownWarnings = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  backend = createBackend(context);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusBarItem.command = 'emailClient.open';
  context.subscriptions.push(statusBarItem);
  void updateStatusBar();

  // Account files are plain JSON on disk; settings events do not cover them,
  // so watch every account folder pattern in every workspace: the settings
  // profiles folder plus the three live-account registry folders.
  for (const root of registryRoots(context)) {
    for (const sub of [
      'settings/accounts/*.json',
      'accounts/*.json',
    ]) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(root), sub)
      );
      const onChange = () => {
        void rebuildBackend(context);
        void AccountsPanel.current?.refresh();
      };
      watcher.onDidCreate(onChange);
      watcher.onDidChange(onChange);
      watcher.onDidDelete(onChange);
      context.subscriptions.push(watcher);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('emailClient.open', () => {
      EmailClientPanel.createOrShow(context.extensionUri, backend, updateStatusBar);
    }),

    vscode.commands.registerCommand('emailClient.compose', () => {
      EmailClientPanel.createOrShow(context.extensionUri, backend, updateStatusBar);
      EmailClientPanel.current?.openCompose();
    }),

    vscode.commands.registerCommand('emailClient.refresh', async () => {
      try {
        await backend.refresh();
        await EmailClientPanel.current?.reload();
        await updateStatusBar();
        void vscode.window.setStatusBarMessage('Email Client: mailboxes refreshed', 3000);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Email Client: refresh failed - ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    vscode.commands.registerCommand('emailClient.switchBackend', async () => {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: 'Mock server',
            description: 'Local JSON mailboxes; no network access',
            value: 'mock' as const,
          },
          {
            label: 'Live',
            description: 'Fetch via extract-email, send via send-email',
            value: 'live' as const,
          },
        ],
        { placeHolder: 'Select the email backend (applies to the flat settings, not accounts)' }
      );
      if (!picked) {
        return;
      }
      await vscode.workspace
        .getConfiguration('emailClient')
        .update('backend', picked.value, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('emailClient.manageAccounts', () => {
      AccountsPanel.createOrShow(
        context.extensionUri,
        () => registryRoots(context),
        async () => {
          await rebuildBackend(context);
        }
      );
    }),

    vscode.commands.registerCommand('emailClient.selectAccount', async () => {
      const config = discoverConfigAccounts(context);
      const { accounts } = discoverAccounts();
      const items: (vscode.QuickPickItem & { id: string })[] = [
        {
          id: '',
          label: 'Default',
          description: 'Flat emailClient.* settings (no account profile)',
        },
        ...config.accounts.map((account) => ({
          id: account.name,
          label: account.name,
          description: `live · ${capabilityLabel(account.capability)} · account registry`,
          detail: account.email,
        })),
        ...accounts.map((account) => ({
          id: account.id,
          label: accountLabel(account),
          description: `${account.backend} · ${
            account.source === 'folder' ? 'settings/accounts file' : 'VS Code settings'
          }`,
          detail: account.email,
        })),
      ];
      const hasAny = config.accounts.length > 0 || accounts.length > 0;
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: hasAny
          ? 'Select the account to use'
          : 'No accounts found - add one with "Email Client: Create Account File"',
      });
      if (!picked) {
        return;
      }
      await vscode.workspace
        .getConfiguration('emailClient')
        .update('activeAccount', picked.id, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('emailClient.createAccountFile', () => {
      AccountsPanel.createOrShow(
        context.extensionUri,
        () => registryRoots(context),
        async () => {
          await rebuildBackend(context);
        }
      );
      AccountsPanel.current?.openAddDialog();
    }),

    vscode.commands.registerCommand('emailClient.openMockData', async () => {
      const dir = mockDataDir(context);
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }),

    vscode.commands.registerCommand('emailClient.resetMockData', async () => {
      const confirmed = await vscode.window.showWarningMessage(
        'Reset mock server data? All changes to mock mailboxes (sent mail, drafts, flags) will be discarded.',
        { modal: true },
        'Reset'
      );
      if (confirmed !== 'Reset') {
        return;
      }
      MockEmailServer.seed(bundledMockDataDir(context), defaultMockDataDir(context), true);
      await rebuildBackend(context);
      void vscode.window.showInformationMessage('Email Client: mock server data reset.');
    }),

    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('emailClient')) {
        await rebuildBackend(context);
      }
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await rebuildBackend(context);
    })
  );
}

export function deactivate(): void {
  // Panel, watcher, and status bar are disposed through context.subscriptions.
}

async function rebuildBackend(context: vscode.ExtensionContext): Promise<void> {
  backend = createBackend(context);
  await EmailClientPanel.current?.setBackend(backend);
  await updateStatusBar();
}

function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/**
 * Roots searched for the account registry, most specific first:
 * an explicit `emailClient.accountsRoot`, then every workspace folder, then
 * the extension's own folder (which is where the registry lives when the
 * extension is run from its own repository).
 */
function registryRoots(context: vscode.ExtensionContext): string[] {
  const configured = vscode.workspace
    .getConfiguration('emailClient')
    .get<string>('accountsRoot', '')
    .trim();
  const roots = [
    ...(configured ? [configured] : []),
    ...workspaceRoots(),
    context.extensionUri.fsPath,
  ];
  // Preserve order while dropping duplicates (case-insensitive on Windows).
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function surfaceWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    if (!shownWarnings.has(warning)) {
      shownWarnings.add(warning);
      void vscode.window.showWarningMessage(`Email Client: ${warning}`);
    }
  }
}

function discoverAccounts(): AccountLoadResult {
  const config = vscode.workspace.getConfiguration('emailClient');
  const settingsAccounts = config.get<unknown[]>('accounts', []);
  const result = loadAccounts(settingsAccounts, workspaceRoots());
  surfaceWarnings(result.warnings);
  return result;
}

/** Accounts from the registry folders under every registry root. */
function discoverConfigAccounts(context: vscode.ExtensionContext): AccountConfigResult {
  const result = loadAccountConfigs(registryRoots(context));
  surfaceWarnings(result.warnings);
  return result;
}

function createBackend(context: vscode.ExtensionContext): EmailBackend {
  const config = vscode.workspace.getConfiguration('emailClient');
  const activeId = config.get<string>('activeAccount', '');
  if (activeId) {
    // Live account registry (accounts/, extract-email/, send-email/) first.
    const registryAccount = discoverConfigAccounts(context).accounts.find(
      (a) => a.name === activeId
    );
    if (registryAccount) {
      return liveBackendFromConfig(registryAccount, config);
    }
    // Then settings / mock profiles.
    const account = discoverAccounts().accounts.find((a) => a.id === activeId);
    if (account) {
      return backendFromAccount(context, account, config);
    }
    const warning = `active account "${activeId}" not found; using the flat settings.`;
    if (!shownWarnings.has(warning)) {
      shownWarnings.add(warning);
      void vscode.window.showWarningMessage(`Email Client: ${warning}`);
    }
  }

  if (config.get<string>('backend') === 'live') {
    return new LiveBackend({
      extractEmailPath: config.get<string>('extractEmailPath', ''),
      sendEmailPath: config.get<string>('sendEmailPath', ''),
      account: config.get<string>('account', '') || undefined,
      messageLimit: config.get<number>('messageLimit', 50),
    });
  }
  return createMockBackend(context, config.get<string>('mockDataPath', ''));
}

/** Build a live backend from a resolved account-registry entry. */
function liveBackendFromConfig(
  account: ResolvedAccount,
  config: vscode.WorkspaceConfiguration
): EmailBackend {
  return new LiveBackend({
    extractEmailPath: config.get<string>('extractEmailPath', ''),
    sendEmailPath: config.get<string>('sendEmailPath', ''),
    extractAccount: account.extract?.toolAccount ?? account.name,
    sendAccount: account.send?.toolAccount ?? account.name,
    capability: account.capability,
    messageLimit: config.get<number>('messageLimit', 50),
    label: account.name,
  });
}

function backendFromAccount(
  context: vscode.ExtensionContext,
  account: EmailAccountConfig,
  config: vscode.WorkspaceConfiguration
): EmailBackend {
  const label = accountLabel(account);
  if (account.backend === 'live') {
    return new LiveBackend({
      extractEmailPath: account.extractEmailPath ?? '',
      sendEmailPath: account.sendEmailPath ?? '',
      account: account.toolAccount,
      messageLimit: account.messageLimit ?? config.get<number>('messageLimit', 50),
      label: `${label} (live)`,
    });
  }
  const identity = account.email
    ? { name: account.name, email: account.email }
    : undefined;
  return createMockBackend(context, account.mockDataPath ?? '', identity, label);
}

function createMockBackend(
  context: vscode.ExtensionContext,
  mockDataPath: string,
  identity?: { name?: string; email: string },
  label?: string
): MockEmailServer {
  const dataDir = mockDataPath || defaultMockDataDir(context);
  if (dataDir === defaultMockDataDir(context)) {
    MockEmailServer.seed(bundledMockDataDir(context), dataDir);
  }
  return new MockEmailServer(dataDir, identity, label);
}

/** Read-only sample data shipped with the extension. */
function bundledMockDataDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, 'mock-server');
}

/** Writable per-user copy of the sample data. */
function defaultMockDataDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'mock-server');
}

function mockDataDir(context: vscode.ExtensionContext): string {
  const configured = vscode.workspace
    .getConfiguration('emailClient')
    .get<string>('mockDataPath', '');
  return configured || defaultMockDataDir(context);
}

async function updateStatusBar(): Promise<void> {
  try {
    const unread = await backend.unreadCount();
    statusBarItem.text = unread > 0 ? `$(mail) ${unread}` : '$(mail)';
    statusBarItem.tooltip = `Email Client (${backend.label}) - ${unread} unread`;
    statusBarItem.show();
  } catch {
    statusBarItem.text = '$(mail)';
    statusBarItem.tooltip = `Email Client (${backend.label})`;
    statusBarItem.show();
  }
}
