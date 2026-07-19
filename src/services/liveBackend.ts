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
 */

import {
  ComposeDraft,
  EmailEnvelope,
  EmailKeywords,
  EmailMessage,
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
  messageLimit: number;
  /** Display label override, e.g. an account name. */
  label?: string;
}

export class LiveBackend implements EmailBackend {
  readonly kind = 'live' as const;
  readonly label: string;

  private readonly extractBridge?: ExtractEmailBridge;
  private readonly sendBridge?: SendEmailBridge;
  private readonly wantExtract: boolean;
  private readonly wantSend: boolean;
  private cache: EmailMessage[] | null = null;

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

  private async inbox(): Promise<EmailMessage[]> {
    if (!this.extractBridge) {
      throw new Error(
        'Live mode extraction is not configured. ' +
          'Either set emailClient.extractEmailPath, install extract-email globally ' +
          '(npm install -g extract-email), or check that the account capability is not send-only.'
      );
    }
    this.cache ??= await this.extractBridge.fetchLatest(this.options.messageLimit);
    return this.cache;
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    if (this.sendOnly) {
      return [
        {
          id: 'inbox',
          name: 'Inbox (send only)',
          role: 'inbox',
          sortOrder: 1,
          totalCount: 0,
          unreadCount: 0,
        },
      ];
    }
    const messages = await this.inbox();
    return [
      {
        id: 'inbox',
        name: 'Inbox',
        role: 'inbox',
        sortOrder: 1,
        totalCount: messages.length,
        unreadCount: messages.filter((m) => !m.keywords.$seen).length,
      },
    ];
  }

  async listMessages(mailboxId: string, limit = 50): Promise<EmailEnvelope[]> {
    if (mailboxId !== 'inbox' || this.sendOnly) {
      return [];
    }
    const messages = await this.inbox();
    return [...messages]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit)
      .map(({ bodyValues: _bodyValues, ...envelope }) => envelope);
  }

  async getMessage(_mailboxId: string, messageId: string): Promise<EmailMessage | undefined> {
    if (this.sendOnly) {
      return undefined;
    }
    // Lazy-load the full message body on demand. The index is encoded in the
    // message ID as "live-<index>-<date>".
    const indexMatch = /^live-(\d+)-/.exec(messageId);
    if (indexMatch && this.extractBridge) {
      const index = parseInt(indexMatch[1], 10);
      const full = await this.extractBridge.fetchOne(index);
      if (full?.bodyValues?.html || full?.bodyValues?.text) {
        // When --html outputs raw HTML without headers the record lacks From/To.
        // Merge with the cached envelope so the reading pane shows correct metadata.
        if (!full.from?.length) {
          const messages = await this.inbox();
          const cached = messages.find((m) => m.id === messageId);
          if (cached) {
            return { ...cached, bodyValues: full.bodyValues };
          }
        }
        return full;
      }
    }
    // Fall back to the in-memory cache when fetching fails or index cannot
    // be parsed from the message ID.
    const messages = await this.inbox();
    return messages.find((m) => m.id === messageId);
  }

  async setKeyword(
    _mailboxId: string,
    messageId: string,
    keyword: keyof EmailKeywords,
    value: boolean
  ): Promise<void> {
    if (this.sendOnly) {
      return;
    }
    const messages = await this.inbox();
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      message.keywords[keyword] = value;
    }
  }

  async deleteMessage(_mailboxId: string, messageId: string): Promise<void> {
    if (this.sendOnly) {
      return;
    }
    // Move the message server-side via the CLI when the bridge supports it.
    const indexMatch = /^live-(\d+)-/.exec(messageId);
    if (indexMatch && this.extractBridge) {
      await this.extractBridge.moveToTrash(parseInt(indexMatch[1], 10));
    }
    // Always clear the cache so the next inbox() fetch reflects the deletion.
    this.cache = null;
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
    this.cache = null;
    await this.inbox();
  }

  async unreadCount(): Promise<number> {
    if (this.sendOnly) {
      return 0;
    }
    try {
      const messages = await this.inbox();
      return messages.filter((m) => !m.keywords.$seen).length;
    } catch {
      return 0;
    }
  }
}
