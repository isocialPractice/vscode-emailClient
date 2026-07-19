/**
 * Backend contract shared by the mock email server and the live bridge.
 * The UI layer only talks to this interface, so backends are swappable
 * at runtime without touching the panel or webview code.
 */

import {
  BackendKind,
  ComposeDraft,
  EmailEnvelope,
  EmailKeywords,
  EmailMessage,
  MailboxSummary,
  SendOutcome,
} from '../types';

export interface EmailBackend {
  readonly kind: BackendKind;
  /** Human-readable label shown in the UI ("Mock server", account name, ...). */
  readonly label: string;

  /** All mailboxes with message counts, sorted for display. */
  listMailboxes(): Promise<MailboxSummary[]>;

  /** Envelopes for a mailbox, newest first, capped at `limit`. */
  listMessages(mailboxId: string, limit?: number): Promise<EmailEnvelope[]>;

  /** Full message including body, or undefined when it no longer exists. */
  getMessage(mailboxId: string, messageId: string): Promise<EmailMessage | undefined>;

  /** Set or clear a keyword flag ($seen, $flagged, ...). */
  setKeyword(
    mailboxId: string,
    messageId: string,
    keyword: keyof EmailKeywords,
    value: boolean
  ): Promise<void>;

  /**
   * Delete a message. Outside the trash mailbox this moves the message to
   * trash; inside trash it removes the message permanently.
   */
  deleteMessage(mailboxId: string, messageId: string): Promise<void>;

  /** Persist a draft; returns the stored draft's message id. */
  saveDraft(draft: ComposeDraft): Promise<string>;

  /** Send a composed message. Never throws; failures come back in the outcome. */
  send(draft: ComposeDraft): Promise<SendOutcome>;

  /** Re-read state from the underlying source (disk, IMAP, ...). */
  refresh(): Promise<void>;

  /** Unread count of the inbox mailbox, for the status bar. */
  unreadCount(): Promise<number>;
}
