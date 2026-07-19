/**
 * Bridge to the send-email tool.
 *
 * Two invocation strategies are supported, selected by whether toolRoot is
 * configured:
 *
 *   toolRoot set   - import dist/core/engine.js and call it in-process
 *                    (requires a local built installation).
 *   toolRoot empty - spawn the globally installed `sendemail` CLI via the OS
 *                    shell; the message body is written to a temp file so
 *                    long or special-character content is never passed on the
 *                    command line directly. No VS Code path setting required.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { ComposeDraft, EmailAddress, SendOutcome } from '../types';
import { formatAddressList, invalidAddresses, parseAddressList } from '../utils/address';
import { importEsm } from '../utils/importEsm';

interface SendEmailEngineModule {
  EmailEngine: new (config: unknown) => SendEmailEngine;
  createEngineConfig: (rootPath: string) => unknown;
}

interface SendEmailEngine {
  initialize(accountName?: string): Promise<void>;
  sendEmail(message: Record<string, unknown>): Promise<{
    success: boolean;
    messageId?: string;
    error?: Error;
  }>;
  verifyConnection(): Promise<boolean>;
  getAccountEmail(): string;
}

export class SendEmailBridge {
  private enginePromise?: Promise<SendEmailEngine>;

  /**
   * @param toolRoot Folder containing a built send-email installation
   *                 (its package.json and dist/ must exist).
   * @param account  Account name defined in the tool's config/accounts/.
   *                 Undefined selects the tool's default account.
   */
  constructor(
    private readonly toolRoot: string,
    private readonly account?: string
  ) {}

  private engine(): Promise<SendEmailEngine> {
    this.enginePromise ??= this.createEngine();
    return this.enginePromise;
  }

  private async createEngine(): Promise<SendEmailEngine> {
    const entry = path.join(this.toolRoot, 'dist', 'core', 'engine.js');
    if (!fs.existsSync(entry)) {
      throw new Error(
        `send-email engine not found at ${entry}. ` +
          'Build the send-email installation (run its "npm run build").' 
      );
    }
    const mod = (await importEsm(pathToFileURL(entry).href)) as unknown as SendEmailEngineModule;
    const engine = new mod.EmailEngine(mod.createEngineConfig(this.toolRoot));
    await engine.initialize(this.account || undefined);
    return engine;
  }

  /** True when the configured account can reach its SMTP server. */
  async verify(): Promise<boolean> {
    if (!this.toolRoot) {
      return true; // Cannot verify without the engine; assume reachable.
    }
    try {
      const engine = await this.engine();
      return await engine.verifyConnection();
    } catch {
      return false;
    }
  }

  async send(draft: ComposeDraft): Promise<SendOutcome> {
    const to = parseAddressList(draft.to);
    const cc = parseAddressList(draft.cc ?? '');
    const bcc = parseAddressList(draft.bcc ?? '');

    if (to.length === 0) {
      return { success: false, error: 'At least one "To" recipient is required.' };
    }
    const invalid = invalidAddresses([...to, ...cc, ...bcc]);
    if (invalid.length > 0) {
      return {
        success: false,
        error: `Invalid address: ${invalid.map((a) => a.email).join(', ')}`,
      };
    }

    return this.toolRoot
      ? this.sendViaEngine(draft, to, cc, bcc)
      : this.sendViaCli(draft, to, cc, bcc);
  }

  private async sendViaEngine(
    draft: ComposeDraft,
    to: EmailAddress[],
    cc: EmailAddress[],
    bcc: EmailAddress[]
  ): Promise<SendOutcome> {
    try {
      const engine = await this.engine();
      const message: Record<string, unknown> = {
        from: engine.getAccountEmail(),
        to: formatAddressList(to),
        subject: draft.subject || '(no subject)',
      };
      if (cc.length > 0) { message.cc = formatAddressList(cc); }
      if (bcc.length > 0) { message.bcc = formatAddressList(bcc); }
      if (draft.isHtml) {
        message.html = draft.body;
      } else {
        message.text = draft.body;
      }
      const result = await engine.sendEmail(message);
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error?.message,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Send via the globally installed `sendemail` CLI.
   * The message body is written to a temp file so that long or
   * special-character content is never passed on the command line.
   * All string arguments are shell-quoted before joining into the
   * command string to handle subjects and addresses with special characters.
   */
  private async sendViaCli(
    draft: ComposeDraft,
    to: EmailAddress[],
    cc: EmailAddress[],
    bcc: EmailAddress[]
  ): Promise<SendOutcome> {
    const tmpPath = this.htmlTempPath();
    try {
      fs.writeFileSync(tmpPath, draft.body || '', 'utf8');

      const parts: string[] = [
        'sendemail',
        '--send-to', ...to.map((a) => this.shellEscape(a.email)),
        '--subject', this.shellEscape(draft.subject || '(no subject)'),
        '--message-html', this.shellEscape(tmpPath),
      ];
      if (cc.length > 0) { parts.push('--cc', ...cc.map((a) => this.shellEscape(a.email))); }
      if (bcc.length > 0) { parts.push('--bcc', ...bcc.map((a) => this.shellEscape(a.email))); }
      if (this.account) { parts.push('--account', this.shellEscape(this.account)); }
      parts.push('--force'); // skip the default confirmation prompt to prevent timeout

      const stdout = await this.runCliCommand(parts.join(' '));
      this.cleanupTempFile(tmpPath);

      const idMatch = /message.id[:\s]+([^\s]+)/i.exec(stdout);
      return { success: true, messageId: idMatch?.[1] };
    } catch (err) {
      this.cleanupTempFile(tmpPath);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Returns the path to the shared HTML temp file used for CLI sends.
   * The file lives under a vscode-emailClient subdirectory of the OS temp
   * folder: %TEMP%\vscode-emailClient\ on Windows, /tmp/vscode-emailClient/
   * on Linux and macOS. The directory is created if it does not exist.
   */
  private htmlTempPath(): string {
    const dir = path.join(os.tmpdir(), 'vscode-emailClient');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, '__temp-vscode-emailclient.html');
  }

  /**
   * Wrap a string for safe embedding in a shell command line.
   * On Windows uses double-quote escaping (CMD); on Unix uses single-quote
   * escaping (sh/bash).
   */
  private shellEscape(s: string): string {
    if (process.platform === 'win32') {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return "'" + s.replace(/'/g, "'\\''" ) + "'";
  }

  /**
   * Spawn the pre-built shell command string via the OS shell with a
   * 60-second timeout to prevent hangs on unresponsive SMTP servers.
   */
  private runCliCommand(cmdStr: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmdStr, [], { windowsHide: true, shell: true });
      let out = '';
      let err = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('sendemail timed out; check your SMTP connection and account settings.'));
      }, 60_000);

      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('error', (spawnErr) => { clearTimeout(timer); reject(spawnErr); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(out);
        } else {
          reject(
            new Error(
              `sendemail exited with code ${code}: ${err.trim() || out.trim() || 'no output'}`
            )
          );
        }
      });
    });
  }

  private cleanupTempFile(tmpPath: string): void {
    try { fs.unlinkSync(tmpPath); } catch { /* Ignore; OS will reclaim. */ }
  }
}
