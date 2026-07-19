/**
 * Email address parsing, formatting, and validation.
 * Accepts the two common textual forms: `user@example.com` and
 * `Display Name <user@example.com>`, in comma-separated lists.
 */

import { EmailAddress } from '../types';

// Pragmatic address check: one non-whitespace local part, an @, and a domain
// with at least one dot. Full RFC 5321 validation is intentionally avoided.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/**
 * Parse a comma-separated address list into structured addresses.
 * Commas inside a quoted display name are preserved.
 * Invalid entries are kept (with the raw text as `email`) so callers can
 * report exactly which entry failed validation.
 */
export function parseAddressList(input: string): EmailAddress[] {
  const result: EmailAddress[] = [];
  for (const part of splitAddresses(input)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const angled = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^<>]+)>$/);
    if (angled) {
      const name = (angled[1] ?? '').trim();
      result.push({ name: name || undefined, email: angled[2].trim() });
    } else {
      result.push({ email: trimmed });
    }
  }
  return result;
}

/** Entries from `parseAddressList` whose address part is not a valid email. */
export function invalidAddresses(addresses: EmailAddress[]): EmailAddress[] {
  return addresses.filter((a) => !isValidEmail(a.email));
}

export function formatAddress(address: EmailAddress): string {
  if (address.name) {
    return `${address.name} <${address.email}>`;
  }
  return address.email;
}

export function formatAddressList(addresses: EmailAddress[]): string {
  return addresses.map(formatAddress).join(', ');
}

/** Split on commas that are outside double quotes and angle brackets. */
function splitAddresses(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '<' && !inQuotes) {
      inAngle = true;
      current += ch;
    } else if (ch === '>' && !inQuotes) {
      inAngle = false;
      current += ch;
    } else if (ch === ',' && !inQuotes && !inAngle) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}
