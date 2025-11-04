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

export const API_RATE_LIMIT_MS = 1000;

