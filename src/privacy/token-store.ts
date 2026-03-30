/**
 * Redis-backed token store for managing PII token mappings.
 *
 * When read_email_with_privacy returns redacted content, sensitive values
 * are replaced with deterministic tokens: [EMAIL:e3f9a], [PHONE:b7c21], etc.
 *
 * This store holds the mapping: e3f9a → john@acme.com (with TTL).
 *
 * When the external AI calls send_email with to: "[EMAIL:e3f9a]",
 * the MCP server resolves the token to the real address before calling Gmail API.
 * The AI never learns the actual PII value.
 *
 * Tokens expire after TTL (default 1 hour) to prevent indefinite re-identification.
 */

import { createClient, RedisClientType } from 'redis';

interface TokenInfo {
  value: string; // the actual PII value (e.g., "john@acme.com")
  type: 'email' | 'phone' | 'ssn' | 'credit_card' | 'api_key' | 'bearer_token';
  messageId: string; // which email this token came from
  createdAt: number; // unix timestamp
}

let redisClient: RedisClientType | null = null;

const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const PREFIX = 'token:';

/**
 * Connect to Redis. Called once at startup.
 * If Redis is not available and REDIS_URL is set, throws an error.
 * If REDIS_URL is not set, returns silently (token store disabled).
 */
export async function initTokenStore(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    process.stderr.write('[TokenStore] REDIS_URL not set — token store disabled\n');
    return;
  }

  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err: Error) => {
      process.stderr.write(`[TokenStore] Redis error: ${err.message}\n`);
    });
    await redisClient.connect();
    process.stderr.write('[TokenStore] Connected to Redis\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[TokenStore] Failed to connect to Redis: ${msg}\n`);
    redisClient = null;
    throw err;
  }
}

/**
 * Store a PII value and return a token placeholder.
 *
 * @param piiValue The actual sensitive value (e.g., "john@acme.com")
 * @param piiType The category of PII
 * @param messageId The email message this PII came from
 * @returns A token ID (e.g., "e3f9a") to use in placeholders like [EMAIL:e3f9a]
 */
export async function storeToken(
  piiValue: string,
  piiType: 'email' | 'phone' | 'ssn' | 'credit_card' | 'api_key' | 'bearer_token',
  messageId: string,
): Promise<string> {
  if (!redisClient) {
    process.stderr.write(
      '[TokenStore] Redis not available — returning empty token (token store disabled)\n',
    );
    return '';
  }

  // Generate a short, deterministic token ID (first 5 chars of a hash)
  const hash = await import('crypto').then((crypto) =>
    crypto.createHash('sha256').update(piiValue + messageId).digest('hex'),
  );
  const tokenId = hash.substring(0, 5);

  const info: TokenInfo = {
    value: piiValue,
    type: piiType,
    messageId,
    createdAt: Date.now(),
  };

  const key = `${PREFIX}${tokenId}`;
  await redisClient.setEx(key, DEFAULT_TTL_SECONDS, JSON.stringify(info));

  return tokenId;
}

/**
 * Resolve a token ID back to the original PII value.
 *
 * @param tokenId The token ID (e.g., "e3f9a")
 * @returns The original PII value, or null if token expired or not found
 */
export async function resolveToken(tokenId: string): Promise<string | null> {
  if (!redisClient) {
    return null;
  }

  const key = `${PREFIX}${tokenId}`;
  const data = await redisClient.get(key);
  if (!data) return null;

  try {
    const info = JSON.parse(data) as TokenInfo;
    return info.value;
  } catch (err) {
    process.stderr.write(`[TokenStore] Failed to parse token ${tokenId}: ${err}\n`);
    return null;
  }
}

/**
 * Get token metadata (for debugging / audit).
 */
export async function getTokenInfo(tokenId: string): Promise<TokenInfo | null> {
  if (!redisClient) {
    return null;
  }

  const key = `${PREFIX}${tokenId}`;
  const data = await redisClient.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as TokenInfo;
  } catch (err) {
    return null;
  }
}

/**
 * Cleanup: close Redis connection.
 */
export async function closeTokenStore(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    process.stderr.write('[TokenStore] Disconnected from Redis\n');
  }
}

/**
 * Check if token store is available.
 */
export function isTokenStoreAvailable(): boolean {
  return redisClient !== null;
}
