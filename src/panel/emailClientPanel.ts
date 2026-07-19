/**
 * Webview panel hosting the three-pane email client UI.
 *
 * The panel owns the message pump between the webview (media/main.js) and
 * the active EmailBackend. All backend errors are caught here and surfaced
 * to the webview as notice messages, so a misconfigured live backend
 * degrades to readable errors instead of a broken panel.
 */

import * as vscode from 'vscode';
import { EmailBackend } from '../services/backend';
import {
  ComposeDraft,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../types';
import { sanitizeEmailHtml, textToHtml } from '../utils/sanitizeHtml';

export class EmailClientPanel {
  static current: EmailClientPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    backend: EmailBackend,
    onStateChange: () => Promise<void>
  ): void {
    if (EmailClientPanel.current) {
      EmailClientPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'emailClient',
      'Email Client',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    EmailClientPanel.current = new EmailClientPanel(panel, extensionUri, backend, onStateChange);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private backend: EmailBackend,
    private readonly onStateChange: () => Promise<void>
  ) {
    this.panel.webview.html = this.renderHtml(extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => void this.handleMessage(message),
      null,
      this.disposables
    );
  }

  async setBackend(backend: EmailBackend): Promise<void> {
    this.backend = backend;
    await this.reload();
  }

  async reload(): Promise<void> {
    await this.sendInit();
  }

  openCompose(draft?: Partial<ComposeDraft>): void {
    this.post({ type: 'compose', draft });
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.sendInit();
          break;

        case 'selectMailbox':
          await this.sendMessageList(message.mailboxId);
          break;

        case 'openMessage': {
          const full = await this.backend.getMessage(message.mailboxId, message.messageId);
          if (!full) {
            this.post({ type: 'notice', level: 'warn', text: 'Message no longer exists.' });
            return;
          }
          if (!full.keywords.$seen) {
            await this.backend.setKeyword(message.mailboxId, message.messageId, '$seen', true);
            full.keywords.$seen = true;
            await this.sendMailboxes();
            await this.onStateChange();
          }
          const sanitizedHtml = full.bodyValues.html
            ? sanitizeEmailHtml(full.bodyValues.html)
            : textToHtml(full.bodyValues.text ?? '');
          this.post({ type: 'message', message: full, sanitizedHtml });
          break;
        }

        case 'setKeyword':
          await this.backend.setKeyword(
            message.mailboxId,
            message.messageId,
            message.keyword,
            message.value
          );
          await this.sendMailboxes();
          await this.sendMessageList(message.mailboxId);
          await this.onStateChange();
          break;

        case 'deleteMessage':
          await this.backend.deleteMessage(message.mailboxId, message.messageId);
          await this.sendMailboxes();
          await this.sendMessageList(message.mailboxId);
          await this.onStateChange();
          break;

        case 'sendDraft': {
          const outcome = await this.backend.send(message.draft);
          this.post({ type: 'sendResult', outcome });
          if (outcome.success) {
            await this.sendMailboxes();
            await this.onStateChange();
          }
          break;
        }

        case 'saveDraft': {
          const draftId = await this.backend.saveDraft(message.draft);
          this.post({ type: 'draftSaved', draftId });
          await this.sendMailboxes();
          break;
        }

        case 'refresh':
          await this.backend.refresh();
          await this.sendInit();
          await this.onStateChange();
          break;
      }
    } catch (err) {
      this.post({
        type: 'notice',
        level: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async sendInit(): Promise<void> {
    const mailboxes = await this.backend.listMailboxes();
    const inbox = mailboxes.find((m) => m.role === 'inbox') ?? mailboxes[0];
    const activeMailboxId = inbox ? inbox.id : '';
    this.post({ type: 'init', backend: this.backend.kind, mailboxes, activeMailboxId });
    if (activeMailboxId) {
      await this.sendMessageList(activeMailboxId);
    }
  }

  private async sendMailboxes(): Promise<void> {
    this.post({ type: 'mailboxes', mailboxes: await this.backend.listMailboxes() });
  }

  private async sendMessageList(mailboxId: string): Promise<void> {
    const limit = vscode.workspace
      .getConfiguration('emailClient')
      .get<number>('messageLimit', 50);
    const messages = await this.backend.listMessages(mailboxId, limit);
    this.post({ type: 'messageList', mailboxId, messages });
  }

  private renderHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const nonce = getNonce();

    // CSP: scripts only with this nonce, images restricted to bundled/data
    // URIs (remote-image blocking is an email privacy default), no frames.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Email Client</title>
</head>
<body>
  <div id="app" data-state="loading">
    <div id="loading" role="status">Loading mailboxes&hellip;</div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    EmailClientPanel.current = undefined;
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
