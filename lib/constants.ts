export const API_ROOTS = {
  MAIN: 'https://2.intelx.io',
  IDENTITY: 'https://3.intelx.io',
  PUBLIC: 'https://public.intelx.io',
  FREE: 'https://free.intelx.io'
} as const;

export const MEDIA_TYPES = {
  0: 'Invalid',
  1: 'Paste',
  2: 'Paste User',
  3: 'Forum',
  4: 'Forum Board',
  5: 'Forum Thread',
  6: 'Forum Post',
  7: 'Forum User',
  8: 'Screenshot',
  9: 'HTML',
  13: 'Tweet',
  14: 'URL',
  15: 'PDF',
  16: 'Word',
  17: 'Excel',
  18: 'PowerPoint',
  19: 'Picture',
  20: 'Audio',
  21: 'Video',
  22: 'Container',
  23: 'HTML File',
  24: 'Text File',
  25: 'Ebook'
} as const;

export const CONTENT_TYPES = {
  0: 'Binary/Unspecified',
  1: 'Plain Text',
  2: 'Picture',
  3: 'Video',
  4: 'Audio',
  5: 'Document',
  6: 'Executable',
  7: 'Container',
  1001: 'User',
  1002: 'Leak',
  1004: 'URL',
  1005: 'Forum'
} as const;

export const SORT_OPTIONS = {
  NO_SORT: 0,
  SCORE_ASC: 1,
  SCORE_DESC: 2,
  DATE_ASC: 3,
  DATE_DESC: 4
} as const;

export const SEARCH_STATUS = {
  SUCCESS: 0,
  NO_MORE_RESULTS: 1,
  NOT_FOUND: 2,
  KEEP_TRYING: 3
} as const;

export const FILE_FORMATS = {
  TEXT: 0,
  HEX: 1,
  AUTO: 2,
  PICTURE: 3,
  NOT_SUPPORTED: 4,
  HTML_INLINE: 5,
  PDF_TEXT: 6,
  HTML_TEXT: 7,
  WORD_TEXT: 8,
  EXCEL_TEXT: 9,
  POWERPOINT_TEXT: 10,
  EBOOK_TEXT: 11,
  TREE_VIEW_HTML: 12,
  TREE_VIEW_JSON: 13
} as const;

export const PHONEBOOK_TARGETS = {
  ALL: 0,
  DOMAINS: 1,
  EMAILS: 2,
  URLS: 3
} as const;

export const API_RATE_LIMIT_MS = 1000; // kept for backwards compat, actual limiter in rate-limiter.ts

// Pre-compiled selector validation regexes (avoids re-compilation per request)
const SELECTOR_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  domain: /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i,
  url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
  ipv6: /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/,
  cidr: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\/(?:\d|[1-2]\d|3[0-2])$/,
  phone: /^\+?[1-9]\d{1,14}$/,
  bitcoin: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  mac: /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
  ipfs: /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  creditCard: /^(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|3\d{13}|6(?:011|5\d{2})\d{12})$/,
  iban: /^[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}$/,
} as const;

export function isStrongSelector(term: string): boolean {
  return Object.values(SELECTOR_PATTERNS).some((re) => re.test(term));
}

export function isDomainOrEmail(term: string): boolean {
  return SELECTOR_PATTERNS.email.test(term) || SELECTOR_PATTERNS.domain.test(term);
}

export function isDomainEmailOrUrl(term: string): boolean {
  return (
    SELECTOR_PATTERNS.domain.test(term) ||
    SELECTOR_PATTERNS.email.test(term) ||
    SELECTOR_PATTERNS.url.test(term)
  );
}
