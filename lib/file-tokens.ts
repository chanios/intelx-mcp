import { randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TOKENS = 1000;

type FileTokenEntry = {
  systemId: string;
  bucket: string;
  type: number;
  expiresAt: number;
};

const tokens = new Map<string, FileTokenEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(key);
  }
}

function mintFileToken(
  systemId: string,
  bucket: string,
  type: number,
): { token: string; expiresAt: number } {
  pruneExpired();
  while (tokens.size >= MAX_TOKENS) {
    const oldest = tokens.keys().next().value;
    if (oldest === undefined) break;
    tokens.delete(oldest);
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  tokens.set(token, { systemId, bucket, type, expiresAt });
  return { token, expiresAt };
}

// One-time redemption: the token is consumed on first use.
function redeemFileToken(token: string): FileTokenEntry | undefined {
  const entry = tokens.get(token);
  if (!entry) return undefined;
  tokens.delete(token);
  if (entry.expiresAt < Date.now()) return undefined;
  return entry;
}

export { mintFileToken, redeemFileToken, TOKEN_TTL_MS };
