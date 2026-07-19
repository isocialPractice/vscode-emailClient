/**
 * Manage Accounts webview panel.
 *
 * Opens on the list of configured accounts. Each account offers Edit and
 * Delete; an Add Account button creates a new one. Structured accounts are
 * edited in a form; accounts defined by a companion tool's native module
 * are opened in the editor instead, since those files are never rewritten.
 *
 * Passwords are never sent to the webview: stored secrets are replaced with
 * a sentinel that is merged back on save.
 */

import * as vscode from 'vscode';
import {
  AccountConfigResult,
  ResolvedAccount,
  capabilityLabel,
  loadAccountConfigs,
} from '../services/accountConfig';
import {
  AccountInput,
  deleteAccount,
  mergeSecrets,
  saveAccount,
  toAccountInput,
  validateAccountName,
} from '../services/accountStore';

/** Row rendered in the account list. */
interface AccountView {
  name: string;
  capability: string;
  capabilityKind: string;
  email?: string;
  files: string[];
  editable: boolean;
  active: boolean;
  input: AccountInput;
}

export class AccountsPanel {
  static current: AccountsPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    roots: () => string[],
    onChanged: () => Promise<void>
  ): void {
    if (AccountsPanel.current) {
      AccountsPanel.current.panel.reveal();
      void AccountsPanel.current.sendAccounts();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'emailClientAccounts',
      'Email Accounts',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    AccountsPanel.current = new AccountsPanel(panel, extensionUri, roots, onChanged);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly roots: () => string[],
    private readonly onChanged: () => Promise<void>
  ) {
    this.panel.webview.html = this.renderHtml(extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => void this.handleMessage(message),
      null,
      this.disposables
    );
  }

  /** Re-read the registry and push the list to the webview. */
  async refresh(): Promise<void> {
    await this.sendAccounts();
  }

  /** Tell the webview to open the Add Account dialog immediately. */
  openAddDialog(): void {
    void this.panel.webview.postMessage({ type: 'openAdd' });
  }

  private discover(): AccountConfigResult {
    return loadAccountConfigs(this.roots());
  }

  private activeAccountName(): string {
    return vscode.workspace.getConfiguration('emailClient').get<string>('activeAccount', '');
  }

  private async sendAccounts(): Promise<void> {
    const { accounts, warnings } = this.discover();
    const active = this.activeAccountName();
    const views: AccountView[] = accounts.map((account) => ({
      name: account.name,
      capability: capabilityLabel(account.capability),
      capabilityKind: account.capability,
      email: account.email,
      files: account.files,
      editable: account.editable,
      active: account.name === active,
      input: toAccountInput(account),
    }));
    void this.panel.webview.postMessage({
      type: 'accounts',
      accounts: views,
      roots: this.roots(),
      warnings,
    });
  }

  private findAccount(name: string): ResolvedAccount | undefined {
    return this.discover().accounts.find((a) => a.name === name);
  }

  private async handleMessage(message: {
    type: string;
    name?: string;
    input?: AccountInput;
    originalName?: string;
  }): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
        case 'refresh':
          await this.sendAccounts();
          break;

        case 'save': {
          if (!message.input) {
            return;
          }
          const invalid = validateAccountName(message.input.name);
          if (invalid) {
            this.notify('error', invalid);
            return;
          }
          const previous = message.originalName
            ? this.findAccount(message.originalName)
            : undefined;
          if (previous && !previous.editable) {
            this.notify(
              'error',
              `"${previous.name}" is defined by a tool module; edit that file directly.`
            );
            return;
          }
          // A new account must not silently overwrite an existing one.
          if (!previous && this.findAccount(message.input.name)) {
            this.notify('error', `An account named "${message.input.name}" already exists.`);
            return;
          }
          const root = this.writableRoot();
          if (!root) {
            return;
          }
          saveAccount(root, mergeSecrets(message.input, previous), previous);
          await this.sendAccounts();
          await this.onChanged();
          this.notify('info', `Account "${message.input.name}" saved.`);
          void this.panel.webview.postMessage({ type: 'closeDialog' });
          break;
        }

        case 'delete': {
          if (!message.name) {
            return;
          }
          const account = this.findAccount(message.name);
          if (!account) {
            this.notify('warn', `Account "${message.name}" no longer exists.`);
            await this.sendAccounts();
            return;
          }
          const confirmed = await vscode.window.showWarningMessage(
            `Delete account "${account.name}"? This removes ${
              account.files.length === 1 ? 'its configuration file' : 'its configuration files'
            }.`,
            { modal: true },
            'Delete'
          );
          if (confirmed !== 'Delete') {
            return;
          }
          deleteAccount(account);
          await this.sendAccounts();
          await this.onChanged();
          this.notify('info', `Account "${account.name}" deleted.`);
          break;
        }

        case 'openFile': {
          if (!message.name) {
            return;
          }
          const account = this.findAccount(message.name);
          if (!account || account.files.length === 0) {
            return;
          }
          const doc = await vscode.workspace.openTextDocument(account.files[0]);
          await vscode.window.showTextDocument(doc);
          break;
        }
      }
    } catch (err) {
      this.notify('error', err instanceof Error ? err.message : String(err));
    }
  }

  /** First registry root; accounts are created under it. */
  private writableRoot(): string | undefined {
    const root = this.roots()[0];
    if (!root) {
      this.notify(
        'error',
        'No registry root available. Open a folder, or set emailClient.accountsRoot.'
      );
      return undefined;
    }
    return root;
  }

  private notify(level: 'info' | 'warn' | 'error', text: string): void {
    void this.panel.webview.postMessage({ type: 'notice', level, text });
  }

  private renderHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'accounts.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'accounts.js')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Email Accounts</title>
</head>
<body>
  <div id="app"><div class="loading" role="status">Loading accounts&hellip;</div></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    AccountsPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
