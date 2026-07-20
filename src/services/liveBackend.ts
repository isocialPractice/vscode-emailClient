/**
 * Live backend: extract-email fetches, send-email sends.
 *
 * Fetched messages are cached in memory for the session. Flag changes and
 * deletions apply to that cache only - IMAP write-back is not implemented
 * in this alpha, so a refresh restores server state. Drafts are not
 * persisted in live mode.
 *
 * Capability: an account may be extract-only, send-only, or both. When a
 * `capability` is supplied (from the account registry) it is authoritative;
 * otherwise it is inferred from which tool paths are configured. A send-only
 * account presents an empty inbox instead of an error, so composing and
 * sending still work - this covers providers whose servers do not allow IMAP
 * extraction but still accept SMTP.
 *
 * Folders: besides the inbox, an account may declare extra IMAP folders
 * (`folders` in its account file or profile). Each one is listed as a
 * mailbox and read through the CLI's `--check <folder>` option. Folder
 * contents are fetched lazily the first time the folder is opened, so
 * listing mailboxes stays a single CLI call; counts for a folder appear
 * once it has been opened.
 */

import {
  ComposeDraft,
  EmailEnvelope,
  EmailKeywords,
  EmailMessage,
  MailboxRole,
  MailboxSummary,
  SendOutcome,
} from '../types';
import { AccountCapability } from './accountConfig';
import { EmailBackend } from './backend';
import { ExtractEmailBridge } from './extractEmailBridge';
import { SendEmailBridge } from './sendEmailBridge';

export interface LiveBackendOptions {
  extractEmailPath: string;
  sendEmailPath: string;
  /** Account name passed to both tools when a per-side name is not given. */
  account?: string;
  /** Account name for the extract-email tool (its `--config`). */
  extractAccount?: string;
  /** Account name for the send-email tool. */
  sendAccount?: string;
  /**
   * Explicit capability from the account registry. When omitted, capability
   * is inferred from which tool paths are set (backward compatible).
   */
  capability?: AccountCapability;
  /** Extra IMAP folders (besides Inbox) to list as mailboxes. */
  folders?: string[];
  messageLimit: number;
  /** Display label override, e.g. an account name. */
  label?: string;
}

/** Sidebar descriptor for one live IMAP folder. */
interface LiveFolder {
  id: string;
  /** Folder name on the IMAP server, passed to `--check`. */
  name: string;
  role: MailboxRole;
  sortOrder: number;
}

const INBOX_ID = 'inbox';

/**
 * Infer a JMAP-style mailbox role from a server folder name, so common
 * folders get their standard sidebar icon and ordering.
 */
export function folderRole(name: string): MailboxRole {
  const key = name.trim().toLowerCase();
  if (/^sent(\s+(items|mail|messages))?$/.test(key)) {
    return 'sent';
  }
  if (key === 'drafts' || key === 'draft') {
    return 'drafts';
  }
  if (/^(trash|bin|deleted(\s+(items|messages))?)$/.test(key)) {
    return 'trash';
  }
  if (key === 'archive' || key === 'archives' || key === 'all mail') {
    return 'archive';
  }
  return 'custom';
}

export class LiveBackend implements EmailBackend {
  readonly kind = 'live' as const;
  readonly label: string;

  private readonly extractBridge?: ExtractEmailBridge;
  private readonly sendBridge?: SendEmailBridge;
  private readonly wantExtract: boolean;
  private readonly wantSend: boolean;
  private readonly folders: LiveFolder[];
  /** Per-mailbox session caches, keyed by mailbox id. */
  private readonly caches = new Map<string, EmailMessage[]>();

  constructor(private readonly options: LiveBackendOptions) {
    this.wantExtract = options.capability
      ? options.capability !== 'send-only'
      : !!options.extractEmailPath;
    this.wantSend = options.capability
      ? options.capability !== 'extract-only'
      : !!options.sendEmailPath;

    // Create the extract bridge whenever extraction is desired. An empty
    // extractEmailPath is valid when extract-email is globally installed;
    // the bridge falls back to the `extractemail` system command in that case.
    if (this.wantExtract && (options.extractEmailPath || options.capability)) {
      this.extractBridge = new ExtractEmailBridge(
        options.extractEmailPath,
        options.extractAccount ?? options.account
      );
    }
    // Create the send bridge whenever sending is desired. An empty
    // sendEmailPath is valid when send-email is globally installed;
    // the bridge falls back to the `sendemail` system command in that case.
    if (this.wantSend && (options.sendEmailPath || options.capability)) {
      this.sendBridge = new SendEmailBridge(
        options.sendEmailPath,
        options.sendAccount ?? options.account
      );
    }

    this.folders = (options.folders ?? []).map((name, index) => ({
      id: `folder:${name.toLowerCase()}`,
      name,
      role: folderRole(name),
      sortOrder: 2 + index,
    }));

    const base = options.label ?? (options.account ? `Live (${options.account})` : 'Live');
    const suffix = this.sendOnly ? ' - send only' : this.extractOnly ? ' - extract only' : '';
    this.label = `${base}${suffix}`;
  }

  /** True when sending is configured but extraction is not. */
  private get sendOnly(): boolean {
    return this.wantSend && !this.wantExtract;
  }

  /** True when extraction is configured but sending is not. */
  private get extractOnly(): boolean {
    return this.wantExtract && !this.wantSend;
  }

  /** Folder descriptor for a mailbox id; undefined for the inbox or unknown ids. */
  private folderOf(mailboxId: string): LiveFolder | undefined {
    return this.folders.find((f) => f.id === mailboxId);
  }

  private requireBridge(): ExtractEmailBridge {
    if (!this.extractBridge) {
      throw new Error(
        'Live mode extraction is not configured. ' +
          'Either set emailClient.extractEmailPath, install extract-email globally ' +
          '(npm install -g extract-email), or check that the account capability is not send-only.'
      );
    }
    return this.extractBridge;
  }

  /**
   * Messages of one mailbox, fetched on first use and cached for the
   * session. The inbox reads the default INBOX; other mailboxes read
   * their IMAP folder via `--check`.
   */
  private async load(mailboxId: string): Promise<EmailMessage[]> {
    const cached = this.caches.get(mailboxId);
    if (cached) {
      return cached;
    }
    const bridge = this.requireBridge();
    const folder = this.folderOf(mailboxId);
    if (mailboxId !== INBOX_ID && !folder) {
      return [];
    }
    const fetched = await bridge.fetchLatest(this.options.messageLimit, folder?.name);
    // The bridge stamps every message with the default inbox id; rewrite it
    // so ids and lookups stay scoped to the mailbox they came from.
    const messages = fetched.map((m) => ({ ...m, mailboxId }));
    this.caches.set(mailboxId, messages);
    return messages;
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    if (this.sendOnly) {
      return [
        {
          id: INBOX_ID,
          name: 'Inbox (send only)',
          role: 'inbox',
          sortOrder: 1,
          totalCount: 0,
          unreadCount: 0,
        },
      ];
    }
    const inbox = await this.load(INBOX_ID);
    const summaries: MailboxSummary[] = [
      {
        id: INBOX_ID,
        name: 'Inbox',
        role: 'inbox',
        sortOrder: 1,
        totalCount: inbox.length,
        unreadCount: inbox.filter((m) => !m.keywords.$seen).length,
      },
    ];
    for (const folder of this.folders) {
      // Lazy: folders are not fetched just to show counts. A folder that has
      // been opened reports its cached counts; others show zero until opened.
      const cached = this.caches.get(folder.id);
      summaries.push({
        id: folder.id,
        name: folder.name,
        role: folder.role,
        sortOrder: folder.sortOrder,
        totalCount: cached?.length ?? 0,
        unreadCount: cached ? cached.filter((m) => !m.keywords.$seen).length : 0,
      });
    }
    return summaries;
  }

  async listMessages(mailboxId: string, limit = 50): Promise<EmailEnvelope[]> {
    if (this.sendOnly) {
      return [];
    }
    if (mailboxId !== INBOX_ID && !this.folderOf(mailboxId)) {
      return [];
    }
    const messages = await this.load(mailboxId);
    return [...messages]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit)
      .map(({ bodyValues: _bodyValues, ...envelope }) => envelope);
  }

  async getMessage(mailboxId: string, messageId: string): Promise<EmailMessage | undefined> {
    if (this.sendOnly) {
      return undefined;
    }
    const folder = this.folderOf(mailboxId);
    // Lazy-load the full message body on demand. The index is encoded in the
    // message ID as "live-<index>-<date>".
    const indexMatch = /^live-(\d+)-/.exec(messageId);
    if (indexMatch && this.extractBridge) {
      const index = parseInt(indexMatch[1], 10);
      const full = await this.extractBridge.fetchOne(index, folder?.name);
      if (full?.bodyValues?.html || full?.bodyValues?.text) {
        // When --html outputs raw HTML without headers the record lacks From/To.
        // Merge with the cached envelope so the reading pane shows correct metadata.
        if (!full.from?.length) {
          const messages = await this.load(mailboxId);
          const cached = messages.find((m) => m.id === messageId);
          if (cached) {
            return { ...cached, bodyValues: full.bodyValues };
          }
        }
        return { ...full, mailboxId };
      }
    }
    // Fall back to the in-memory cache when fetching fails or index cannot
    // be parsed from the message ID.
    const messages = await this.load(mailboxId);
    return messages.find((m) => m.id === messageId);
  }

  async setKeyword(
    mailboxId: string,
    messageId: string,
    keyword: keyof EmailKeywords,
    value: boolean
  ): Promise<void> {
    if (this.sendOnly) {
      return;
    }
    const messages = await this.load(mailboxId);
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      message.keywords[keyword] = value;
    }
  }

  async deleteMessage(mailboxId: string, messageId: string): Promise<void> {
    if (this.sendOnly) {
      return;
    }
    const folder = this.folderOf(mailboxId);
    // Messages already in a trash folder cannot be moved to trash again, and
    // the CLI has no permanent delete, so their removal stays session-local.
    if (folder?.role === 'trash') {
      const cached = this.caches.get(mailboxId);
      if (cached) {
        this.caches.set(
          mailboxId,
          cached.filter((m) => m.id !== messageId)
        );
      }
      return;
    }
    // Move the message server-side via the CLI when the bridge supports it.
    const indexMatch = /^live-(\d+)-/.exec(messageId);
    if (indexMatch && this.extractBridge) {
      await this.extractBridge.moveToTrash(parseInt(indexMatch[1], 10), folder?.name);
    }
    // Drop the source mailbox cache so the next fetch reflects the deletion,
    // and any cached trash folder so the moved message appears there.
    this.caches.delete(mailboxId);
    for (const f of this.folders) {
      if (f.role === 'trash') {
        this.caches.delete(f.id);
      }
    }
  }

  async saveDraft(_draft: ComposeDraft): Promise<string> {
    throw new Error('Drafts are not supported in live mode yet; switch to the mock backend.');
  }

  async send(draft: ComposeDraft): Promise<SendOutcome> {
    if (this.extractOnly) {
      return {
        success: false,
        error: 'This account is extract-only; configure a send account to send mail.',
      };
    }
    if (!this.sendBridge) {
      return {
        success: false,
        error: 'Live mode needs emailClient.sendEmailPath set to a local send-email installation.',
      };
    }
    return this.sendBridge.send(draft);
  }

  async refresh(): Promise<void> {
    if (this.sendOnly) {
      return;
    }
    this.caches.clear();
    await this.load(INBOX_ID);
  }

  async unreadCount(): Promise<number> {
    if (this.sendOnly) {
      return 0;
    }
    try {
      const messages = await this.load(INBOX_ID);
      return messages.filter((m) => !m.keywords.$seen).length;
    } catch {
      return 0;
    }
  }
}
