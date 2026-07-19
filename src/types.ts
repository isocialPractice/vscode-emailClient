/**
 * Shared domain model for the email client.
 *
 * The message shape follows a simplified version of the JMAP Email object
 * (RFC 8621), which is also the storage format used by the mock email server.
 * Both live backends (extract-email, send-email) are mapped into this model.
 */

/** A single mailbox participant. */
export interface EmailAddress {
  name?: string;
  email: string;
}

/** Well-known mailbox roles, mirroring JMAP mailbox roles. */
export type MailboxRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive' | 'custom';

/** Mailbox metadata plus message counts, used by the sidebar. */
export interface MailboxSummary {
  id: string;
  name: string;
  role: MailboxRole;
  sortOrder: number;
  totalCount: number;
  unreadCount: number;
}

/** Attachment metadata. Bodies are not stored in the mock data. */
export interface EmailAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

/** JMAP-style keyword flags. Absent keys are treated as false. */
export interface EmailKeywords {
  $seen?: boolean;
  $flagged?: boolean;
  $draft?: boolean;
  $answered?: boolean;
}

/** Header-level message data; enough to render a message list row. */
export interface EmailEnvelope {
  id: string;
  threadId?: string;
  mailboxId: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  /** ISO 8601 timestamp. */
  receivedAt: string;
  /** Short plain-text snippet for list rows. */
  preview?: string;
  keywords: EmailKeywords;
  hasAttachment: boolean;
  attachments?: EmailAttachment[];
}

/** Full message, including body content. */
export interface EmailMessage extends EmailEnvelope {
  bodyValues: {
    text?: string;
    html?: string;
  };
}

/**
 * A message being composed in the UI. Address fields hold raw user input
 * (comma-separated, `Name <user@example.com>` accepted) and are parsed by
 * the backend before sending.
 */
export interface ComposeDraft {
  /** Present when editing an existing draft. */
  id?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /** When true, `body` is treated as HTML; otherwise plain text. */
  isHtml?: boolean;
  /** Message id being replied to, if any. */
  inReplyToId?: string;
}

/** Outcome of a send attempt, normalized across backends. */
export interface SendOutcome {
  success: boolean;
  messageId?: string;
  error?: string;
}

export type BackendKind = 'mock' | 'live';

// ─── Webview message protocol ────────────────────────────────────────────────

/** Messages sent from the webview to the extension host. */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'selectMailbox'; mailboxId: string }
  | { type: 'openMessage'; mailboxId: string; messageId: string }
  | { type: 'setKeyword'; mailboxId: string; messageId: string; keyword: keyof EmailKeywords; value: boolean }
  | { type: 'deleteMessage'; mailboxId: string; messageId: string }
  | { type: 'sendDraft'; draft: ComposeDraft }
  | { type: 'saveDraft'; draft: ComposeDraft }
  | { type: 'refresh' };

/** Messages sent from the extension host to the webview. */
export type HostToWebviewMessage =
  | { type: 'init'; backend: BackendKind; mailboxes: MailboxSummary[]; activeMailboxId: string }
  | { type: 'mailboxes'; mailboxes: MailboxSummary[] }
  | { type: 'messageList'; mailboxId: string; messages: EmailEnvelope[] }
  | { type: 'message'; message: EmailMessage; sanitizedHtml?: string }
  | { type: 'sendResult'; outcome: SendOutcome }
  | { type: 'draftSaved'; draftId: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  | { type: 'compose'; draft?: Partial<ComposeDraft> };
