/**
 * Mock email server.
 *
 * A fully local EmailBackend backed by JSON mailbox files in a data folder
 * (one file per mailbox under `mailboxes/`). The storage format is a
 * simplified JMAP Email object (RFC 8621) - see docs/MOCK-SERVER.md.
 *
 * Used for UI preview, automated tests, debugging, previewing email
 * rendering, and mock sending. This module has no dependency on the
 * `vscode` API so it can run under plain Node in unit tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ComposeDraft,
  EmailAddress,
  EmailEnvelope,
  EmailKeywords,
  EmailMessage,
  MailboxRole,
  MailboxSummary,
  SendOutcome,
} from '../types';
import { EmailBackend } from './backend';
import { invalidAddresses, parseAddressList } from '../utils/address';

/** On-disk shape of one mailbox file. */
interface MailboxFile {
  id: string;
  name: string;
  role: MailboxRole;
  sortOrder: number;
  emails: EmailMessage[];
}

/**
 * Sending to this address makes the mock server report a failed delivery.
 * Lets the UI's error path be exercised without a real SMTP failure.
 */
export const MOCK_BOUNCE_ADDRESS = 'bounce@example.com';

/** Identity the mock server sends from. */
export const MOCK_SELF: EmailAddress = { name: 'Demo User', email: 'demo-user@example.com' };

export class MockEmailServer implements EmailBackend {
  readonly kind = 'mock' as const;
  readonly label: string;

  private mailboxes = new Map<string, MailboxFile>();
  private loaded = false;
  private readonly identity: EmailAddress;

  /**
   * @param dataDir  Folder containing a `mailboxes/` subfolder.
   * @param identity Sender identity for mock sends and drafts (defaults to
   *                 the built-in demo identity).
   * @param label    Display label, e.g. an account name.
   */
  constructor(
    private readonly dataDir: string,
    identity?: EmailAddress,
    label?: string
  ) {
    this.identity = identity ?? MOCK_SELF;
    this.label = label ?? 'Mock server';
  }

  /**
   * Copy bundled sample data into a writable location when that location
   * does not exist yet (or when `force` is set). Keeps the shipped fixtures
   * pristine while the working copy absorbs reads/sends/deletes.
   */
  static seed(sourceDir: string, targetDir: string, force = false): void {
    if (force && fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    if (fs.existsSync(path.join(targetDir, 'mailboxes'))) {
      return;
    }
    fs.cpSync(sourceDir, targetDir, { recursive: true });
  }

  private mailboxDir(): string {
    return path.join(this.dataDir, 'mailboxes');
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    const dir = this.mailboxDir();
    if (!fs.existsSync(dir)) {
      throw new Error(`Mock server data folder not found: ${dir}`);
    }
    this.mailboxes.clear();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const mailbox = JSON.parse(raw) as MailboxFile;
      mailbox.emails ??= [];
      this.mailboxes.set(mailbox.id, mailbox);
    }
    this.loaded = true;
  }

  private persist(mailbox: MailboxFile): void {
    const file = path.join(this.mailboxDir(), `${mailbox.id}.json`);
    fs.writeFileSync(file, JSON.stringify(mailbox, null, 2) + '\n', 'utf8');
  }

  private getMailbox(mailboxId: string): MailboxFile {
    this.ensureLoaded();
    const mailbox = this.mailboxes.get(mailboxId);
    if (!mailbox) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    return mailbox;
  }

  private byRole(role: MailboxRole): MailboxFile | undefined {
    this.ensureLoaded();
    for (const mailbox of this.mailboxes.values()) {
      if (mailbox.role === role) {
        return mailbox;
      }
    }
    return undefined;
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    this.ensureLoaded();
    return [...this.mailboxes.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        sortOrder: m.sortOrder,
        totalCount: m.emails.length,
        unreadCount: m.emails.filter((e) => !e.keywords.$seen).length,
      }));
  }

  async listMessages(mailboxId: string, limit = 50): Promise<EmailEnvelope[]> {
    const mailbox = this.getMailbox(mailboxId);
    return [...mailbox.emails]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit)
      .map(({ bodyValues: _bodyValues, ...envelope }) => envelope);
  }

  async getMessage(mailboxId: string, messageId: string): Promise<EmailMessage | undefined> {
    const mailbox = this.getMailbox(mailboxId);
    return mailbox.emails.find((e) => e.id === messageId);
  }

  async setKeyword(
    mailboxId: string,
    messageId: string,
    keyword: keyof EmailKeywords,
    value: boolean
  ): Promise<void> {
    const mailbox = this.getMailbox(mailboxId);
    const message = mailbox.emails.find((e) => e.id === messageId);
    if (!message) {
      throw new Error(`Unknown message: ${messageId}`);
    }
    message.keywords[keyword] = value;
    this.persist(mailbox);
  }

  async deleteMessage(mailboxId: string, messageId: string): Promise<void> {
    const mailbox = this.getMailbox(mailboxId);
    const index = mailbox.emails.findIndex((e) => e.id === messageId);
    if (index === -1) {
      throw new Error(`Unknown message: ${messageId}`);
    }
    const [message] = mailbox.emails.splice(index, 1);
    this.persist(mailbox);

    const trash = this.byRole('trash');
    if (mailbox.role !== 'trash' && trash) {
      message.mailboxId = trash.id;
      trash.emails.push(message);
      this.persist(trash);
    }
    // Inside trash (or with no trash mailbox) the removal is permanent.
  }

  async saveDraft(draft: ComposeDraft): Promise<string> {
    const drafts = this.byRole('drafts');
    if (!drafts) {
      throw new Error('No drafts mailbox in mock data');
    }
    if (draft.id) {
      const index = drafts.emails.findIndex((e) => e.id === draft.id);
      if (index !== -1) {
        drafts.emails.splice(index, 1);
      }
    }
    const message = this.draftToMessage(draft, drafts.id, { $seen: true, $draft: true });
    drafts.emails.push(message);
    this.persist(drafts);
    return message.id;
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
    if ([...to, ...cc, ...bcc].some((a) => a.email.toLowerCase() === MOCK_BOUNCE_ADDRESS)) {
      return {
        success: false,
        error: `Delivery to ${MOCK_BOUNCE_ADDRESS} failed (simulated bounce).`,
      };
    }

    const sent = this.byRole('sent');
    if (!sent) {
      return { success: false, error: 'No sent mailbox in mock data.' };
    }
    const message = this.draftToMessage(draft, sent.id, { $seen: true });
    sent.emails.push(message);
    this.persist(sent);

    // Sending a stored draft consumes it.
    if (draft.id) {
      const drafts = this.byRole('drafts');
      if (drafts) {
        const index = drafts.emails.findIndex((e) => e.id === draft.id);
        if (index !== -1) {
          drafts.emails.splice(index, 1);
          this.persist(drafts);
        }
      }
    }

    // Answered flag on the message that was replied to.
    if (draft.inReplyToId) {
      for (const mailbox of this.mailboxes.values()) {
        const original = mailbox.emails.find((e) => e.id === draft.inReplyToId);
        if (original) {
          original.keywords.$answered = true;
          this.persist(mailbox);
          break;
        }
      }
    }

    return { success: true, messageId: message.id };
  }

  async refresh(): Promise<void> {
    this.loaded = false;
    this.ensureLoaded();
  }

  async unreadCount(): Promise<number> {
    const inbox = this.byRole('inbox');
    if (!inbox) {
      return 0;
    }
    return inbox.emails.filter((e) => !e.keywords.$seen).length;
  }

  private draftToMessage(
    draft: ComposeDraft,
    mailboxId: string,
    keywords: EmailKeywords
  ): EmailMessage {
    const body = draft.body ?? '';
    return {
      id: `eml-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      mailboxId,
      from: [this.identity],
      to: parseAddressList(draft.to),
      cc: parseAddressList(draft.cc ?? ''),
      subject: draft.subject || '(no subject)',
      receivedAt: new Date().toISOString(),
      preview: body.replace(/\s+/g, ' ').trim().slice(0, 120),
      keywords,
      hasAttachment: false,
      bodyValues: draft.isHtml ? { html: body } : { text: body },
    };
  }
}
