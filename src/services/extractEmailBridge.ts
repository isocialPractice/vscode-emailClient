/**
 * Bridge to the extract-email tool, consumed as an API call.
 *
 * extract-email is a CLI whose entry module runs on import, so it is not
 * embeddable as a library. Instead this bridge treats each fetch like a
 * request to an external service: spawn the CLI in JSON mode, collect
 * stdout, and normalize the parsed records into this extension's message
 * model. Accounts, filters, and credentials all stay configured inside
 * the extract-email installation itself.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { EmailAddress, EmailMessage } from '../types';
import { parseAddressList } from '../utils/address';

/** CLI arguments selecting a non-default IMAP folder, when one is given. */
function folderArgs(folder?: string): string[] {
  return folder ? ['--check', folder] : [];
}

export class ExtractEmailBridge {
  /**
   * @param toolRoot Folder containing a built extract-email installation.
   * @param account  Account/config name understood by the tool's --config
   *                 option. Undefined uses the tool's default config.
   */
  constructor(
    private readonly toolRoot: string,
    private readonly account?: string
  ) {}

  /**
   * Fetch the latest `count` messages from the configured IMAP account.
   * When `folder` is given the CLI reads that IMAP folder via `--check`
   * instead of the default INBOX.
   */
  async fetchLatest(count: number, folder?: string): Promise<EmailMessage[]> {
    if (this.toolRoot) {
      const entry = path.join(this.toolRoot, 'dist', 'extractEmail.js');
      if (!fs.existsSync(entry)) {
        throw new Error(
          `extract-email CLI not found at ${entry}. ` +
            'Build the installation first (run its "npm run build").'
        );
      }
    }

    // Count is a positional argument; passing --json consumed it as the flag's
    // value and caused the tool to return only 1 (default) message.
    const { command, args, cwd, shell } = this.buildInvocation([
      ...folderArgs(folder),
      String(count),
    ]);
    const stdout = await this.runToFile(command, args, cwd, shell);
    return this.parseRecords(stdout).map((record, index) => this.toMessage(record, index));
  }

  /**
   * Fetch one message by its 0-based position in the account's recent list.
   * Runs the CLI with `--number <n>` (1-based) to retrieve only that message,
   * enabling lazy body loading when the user opens a message. Returns undefined
   * when the CLI does not support `--number` or the index is out of range;
   * callers fall back to the in-memory cache.
   */
  async fetchOne(index: number, folder?: string): Promise<EmailMessage | undefined> {
    if (this.toolRoot) {
      const entry = path.join(this.toolRoot, 'dist', 'extractEmail.js');
      if (!fs.existsSync(entry)) {
        return undefined;
      }
    }

    const { command, args, cwd, shell } = this.buildInvocation([
      ...folderArgs(folder),
      '-n',
      String(index + 1),
      '--html',
    ]);
    try {
      const stdout = await this.runToFile(command, args, cwd, shell);

      // Try structured parsing (=== Email #N === or JSON).
      let records: Record<string, unknown>[];
      try {
        records = this.parseRecords(stdout);
      } catch {
        // parseRecords throws when no known format is detected.
        // --html sometimes emits raw HTML without any === frame;
        // treat the entire output as an HTML-only body record.
        const trimmed = stdout.trim();
        records = trimmed.length > 0 ? [{ html: trimmed }] : [];
      }

      if (records.length === 0) {
        return undefined;
      }

      const record = records[0];
      // The text-format parser stores the body under `text`. When the CLI was
      // invoked with --html that content is already HTML, so promote it to the
      // `html` field so the panel renders it rather than escaping it.
      if (typeof record.text === 'string' && !record.html) {
        record.html = record.text;
        delete record.text;
      }

      return this.toMessage(record, index);
    } catch {
      return undefined;
    }
  }

  /**
   * Move a message to the trash folder via the CLI.
   * Uses `--move trash` which instructs extract-email to IMAP-move the
   * message server-side. Index is 0-based; the CLI flag is 1-based.
   */
  async moveToTrash(index: number, folder?: string): Promise<void> {
    if (this.toolRoot) {
      const entry = path.join(this.toolRoot, 'dist', 'extractEmail.js');
      if (!fs.existsSync(entry)) {
        return;
      }
    }
    const { command, args, cwd, shell } = this.buildInvocation([
      ...folderArgs(folder),
      '-n',
      String(index + 1),
      '--move',
      'trash',
    ]);
    try {
      await this.runToFile(command, args, cwd, shell);
    } catch {
      // Best-effort: if the server-side move fails the cache is still cleared.
    }
  }

  /**
   * Build the command invocation for the extract-email CLI.
   * When toolRoot is configured the entry script is run directly through
   * node; otherwise the globally installed `extractemail` binary is invoked
   * via the OS shell, which handles PATH resolution and .cmd wrappers on
   * Windows automatically.
   */
  private buildInvocation(extraArgs: string[]): {
    command: string;
    args: string[];
    cwd: string;
    shell: boolean;
  } {
    const accountArgs = this.account ? [`--config=${this.account}`] : [];
    const fullArgs = [...extraArgs, ...accountArgs];

    if (this.toolRoot) {
      return {
        command: process.execPath,
        args: [path.join(this.toolRoot, 'dist', 'extractEmail.js'), ...fullArgs],
        cwd: this.toolRoot,
        shell: false,
      };
    }

    // No installation path - fall back to the globally installed command.
    // With shell:true Node performs no escaping, so quote arguments that
    // contain whitespace (e.g. folder names like "Sent Items").
    return {
      command: 'extractemail',
      args: fullArgs.map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '')}"` : arg)),
      cwd: process.cwd(),
      shell: true,
    };
  }

  /**
   * Spawn the CLI and redirect stdout to a uniquely-named OS temp file so
   * the child process is never blocked by a full pipe buffer. After the
   * process exits the file is read, returned as a string, and deleted.
   *
   * A 120-second watchdog kills the child and rejects with a clear message
   * when the IMAP connection hangs indefinitely, which is the root cause of
   * "Loading mailboxes; then freezes".
   */
  private runToFile(command: string, args: string[], cwd: string, shell = false): Promise<string> {
    const tmpPath = path.join(
      os.tmpdir(),
      `vscode-mailClient-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    );
    return new Promise((resolve, reject) => {
      const outStream = fs.createWriteStream(tmpPath);
      const child = spawn(command, args, { cwd, windowsHide: true, shell });
      let err = '';
      let exitCode: number | null = null;
      let childDone = false;
      let streamDone = false;

      const timer = setTimeout(() => {
        child.kill();
        this.cleanupTempFile(tmpPath);
        reject(new Error('extract-email timed out; check your IMAP connection and account settings.'));
      }, 120_000);

      const tryFinish = () => {
        if (!childDone || !streamDone) {
          return;
        }
        clearTimeout(timer);
        if (exitCode === 0) {
          try {
            const stdout = fs.readFileSync(tmpPath, 'utf8');
            this.cleanupTempFile(tmpPath);
            resolve(stdout);
          } catch (readErr) {
            this.cleanupTempFile(tmpPath);
            reject(readErr);
          }
        } else {
          this.cleanupTempFile(tmpPath);
          reject(
            new Error(
              `extract-email exited with code ${exitCode}: ${err.trim() || 'no output'}`
            )
          );
        }
      };

      child.stdout.pipe(outStream);
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('error', (spawnErr) => {
        clearTimeout(timer);
        outStream.destroy();
        this.cleanupTempFile(tmpPath);
        reject(spawnErr);
      });
      child.on('close', (code) => {
        exitCode = code;
        childDone = true;
        tryFinish();
      });
      outStream.on('error', (streamErr) => {
        clearTimeout(timer);
        child.kill();
        this.cleanupTempFile(tmpPath);
        reject(streamErr);
      });
      outStream.on('finish', () => {
        streamDone = true;
        tryFinish();
      });
    });
  }

  private cleanupTempFile(tmpPath: string): void {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore; the OS will reclaim the file eventually.
    }
  }

  /**
   * Parse the default === Email #N === plain-text CLI output.
   * Each section begins at that header; header lines are "Key: value";
   * everything after "Body:" is treated as the message body.
   */
  private parseTextFormat(stdout: string): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [];
    const sections = stdout.split(/={3}\s*Email\s*#\d+\s*={3}/);
    for (const section of sections) {
      if (!section.trim()) {
        continue;
      }
      const record: Record<string, unknown> = {};
      const lines = section.split(/\r?\n/);
      let inBody = false;
      const bodyLines: string[] = [];

      for (const line of lines) {
        if (inBody) {
          bodyLines.push(line);
          continue;
        }
        // Body: may have content on the same line (e.g. "Body: <body style=...>")
        // or may be a standalone label followed by content on the next line.
        if (/^Body:/i.test(line)) {
          inBody = true;
          const after = line.slice(line.indexOf(':') + 1).trimStart();
          if (after) {
            bodyLines.push(after);
          }
          continue;
        }
        const match = /^(From|To|Date|Subject|Attachment):\s*(.*)$/.exec(line);
        if (match) {
          record[match[1].toLowerCase()] = match[2].trim();
        }
      }

      if (inBody) {
        record['text'] = bodyLines.join('\n').trimEnd();
      }
      if (record.subject !== undefined || record.from !== undefined) {
        records.push(record);
      }
    }
    return records;
  }

  /**
   * Accept JSON (array or single object), newline-delimited JSON objects,
   * or the default === Email #N === plain-text format. JSON is tried first
   * because it is fully structured; text format is the fallback for bare
   * CLI invocations without --json.
   */
  private parseRecords(stdout: string): Record<string, unknown>[] {
    const trimmed = stdout.trim();

    // Try JSON array or single object (--json flag output).
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Not a top-level JSON document; continue.
    }

    // Try newline-delimited JSON (one object per line).
    const ndjson: Record<string, unknown>[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate.startsWith('{')) {
        try {
          ndjson.push(JSON.parse(candidate));
        } catch {
          // Non-JSON log line; skip.
        }
      }
    }
    if (ndjson.length > 0) {
      return ndjson;
    }

    // Try the === Email #N === plain-text format (default CLI output).
    if (trimmed.includes('=== Email #')) {
      const records = this.parseTextFormat(trimmed);
      if (records.length > 0) {
        return records;
      }
    }

    throw new Error('extract-email produced no parseable output.');
  }

  /** Normalize one extracted record (mailparser-shaped) into an EmailMessage. */
  private toMessage(record: Record<string, unknown>, index: number): EmailMessage {
    const subject = typeof record.subject === 'string' ? record.subject : '(no subject)';
    const date =
      typeof record.date === 'string' && !Number.isNaN(Date.parse(record.date))
        ? new Date(record.date).toISOString()
        : new Date().toISOString();
    const text = typeof record.text === 'string' ? record.text : undefined;
    const html = typeof record.html === 'string' ? record.html : undefined;
    const preview = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

    return {
      id: `live-${index}-${date}`,
      mailboxId: 'inbox',
      from: this.toAddresses(record.from),
      to: this.toAddresses(record.to),
      subject,
      receivedAt: date,
      preview,
      keywords: { $seen: true },
      hasAttachment: this.recordHasAttachment(record),
      bodyValues: { text, html },
    };
  }

  /**
   * Whether a record contains attachments. Handles both the --json array
   * (mailparser) and the text-format "Attachment: filename.pdf" string.
   */
  private recordHasAttachment(record: Record<string, unknown>): boolean {
    if (Array.isArray(record.attachments)) {
      return record.attachments.length > 0;
    }
    if (typeof record.attachment === 'string') {
      return record.attachment.toLowerCase() !== 'false';
    }
    return false;
  }

  /**
   * Address fields may arrive as RFC 5322 strings from the plain-text output
   * ("Name <email>" or bare "email") or as mailparser objects from --json.
   */
  private toAddresses(value: unknown): EmailAddress[] {
    if (typeof value === 'string') {
      return parseAddressList(value);
    }
    if (value && typeof value === 'object') {
      const objectValue = value as { value?: unknown; text?: unknown };
      if (Array.isArray(objectValue.value)) {
        return objectValue.value
          .map((entry) => entry as { name?: string; address?: string })
          .filter((entry) => typeof entry.address === 'string')
          .map((entry) => ({ name: entry.name || undefined, email: entry.address as string }));
      }
      if (typeof objectValue.text === 'string') {
        return parseAddressList(objectValue.text);
      }
    }
    return [];
  }
}
