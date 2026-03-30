/**
 * SQLite-backed audit log for PII redaction events.
 *
 * Records every time PII is detected and redacted, with:
 * - timestamp, messageId, field name
 * - PII types found (email, phone, SSN, etc.) and counts
 * - redaction engine used (deterministic vs vLLM)
 *
 * Persists to /app/audit.db (or process.cwd()/audit.db for local dev)
 * Useful for compliance, legal hold, and debugging.
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'audit.db');
let db: Database.Database | null = null;

/**
 * Initialize the audit database and create schema if not exists.
 */
export function initAuditDb(): void {
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // write-ahead logging for better concurrency

    db.exec(`
      CREATE TABLE IF NOT EXISTS redaction_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        messageId TEXT NOT NULL,
        field TEXT NOT NULL,
        piiType TEXT NOT NULL,
        count INTEGER NOT NULL,
        engine TEXT NOT NULL,
        fromAddress TEXT,
        subject TEXT,
        UNIQUE(messageId, field, piiType)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_messageId ON redaction_audit(messageId);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON redaction_audit(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_piiType ON redaction_audit(piiType);
    `);

    process.stderr.write(`[AuditDB] Initialized at ${dbPath}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[AuditDB] Failed to initialize: ${msg}\n`);
    throw err;
  }
}

export interface RedactionRecord {
  messageId: string;
  field: 'subject' | 'snippet' | 'body';
  findings: Array<{ type: string; count: number }>; // e.g., [{type: "email", count: 2}]
  engine: string; // "deterministic-local" or "crewai-swarm-vllm+deterministic"
  fromAddress?: string;
  subject?: string;
}

/**
 * Log a redaction event to the audit database.
 * Upserts on (messageId, field, piiType) to avoid duplicates.
 */
export function logRedactionEvent(record: RedactionRecord): void {
  if (!db) {
    process.stderr.write('[AuditDB] Database not initialized\n');
    return;
  }

  try {
    for (const finding of record.findings) {
      const stmt = db.prepare(`
        INSERT INTO redaction_audit
          (messageId, field, piiType, count, engine, fromAddress, subject)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(messageId, field, piiType) DO UPDATE SET
          count = excluded.count,
          engine = excluded.engine,
          timestamp = CURRENT_TIMESTAMP
      `);

      stmt.run(
        record.messageId,
        record.field,
        finding.type,
        finding.count,
        record.engine,
        record.fromAddress || null,
        record.subject || null,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[AuditDB] Failed to log event: ${msg}\n`);
  }
}

/**
 * Query audit log for a specific message.
 */
export function getAuditByMessageId(messageId: string): RedactionRecord[] {
  if (!db) return [];

  try {
    const stmt = db.prepare(`
      SELECT messageId, field, piiType, count, engine, fromAddress, subject
      FROM redaction_audit
      WHERE messageId = ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(messageId) as Array<{
      messageId: string;
      field: string;
      piiType: string;
      count: number;
      engine: string;
      fromAddress: string | null;
      subject: string | null;
    }>;

    // Group findings by messageId/field/engine
    const results: { [key: string]: RedactionRecord } = {};
    for (const row of rows) {
      const key = `${row.messageId}|${row.field}`;
      if (!results[key]) {
        results[key] = {
          messageId: row.messageId,
          field: row.field as 'subject' | 'snippet' | 'body',
          findings: [],
          engine: row.engine,
          fromAddress: row.fromAddress || undefined,
          subject: row.subject || undefined,
        };
      }
      results[key].findings.push({ type: row.piiType, count: row.count });
    }

    return Object.values(results);
  } catch (err) {
    process.stderr.write(`[AuditDB] Query failed: ${err}\n`);
    return [];
  }
}

/**
 * Get all PII type frequencies (for statistics).
 */
export function getPiiStatistics(): { type: string; totalOccurrences: number }[] {
  if (!db) return [];

  try {
    const stmt = db.prepare(`
      SELECT piiType, SUM(count) as totalOccurrences
      FROM redaction_audit
      GROUP BY piiType
      ORDER BY totalOccurrences DESC
    `);

    return stmt.all() as { type: string; totalOccurrences: number }[];
  } catch (err) {
    process.stderr.write(`[AuditDB] Statistics query failed: ${err}\n`);
    return [];
  }
}

/**
 * Export audit log as JSON (for compliance export).
 */
export function exportAuditLog(from?: Date, to?: Date): string {
  if (!db) return '[]';

  try {
    let query = 'SELECT * FROM redaction_audit';
    const params: (Date | undefined)[] = [];

    if (from || to) {
      query += ' WHERE';
      if (from) {
        query += ' timestamp >= ?';
        params.push(from);
      }
      if (to) {
        query += (from ? ' AND' : '') + ' timestamp <= ?';
        params.push(to);
      }
    }

    query += ' ORDER BY timestamp DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return JSON.stringify(rows, null, 2);
  } catch (err) {
    process.stderr.write(`[AuditDB] Export failed: ${err}\n`);
    return '[]';
  }
}

/**
 * Close the database connection.
 */
export function closeAuditDb(): void {
  if (db) {
    db.close();
    db = null;
    process.stderr.write('[AuditDB] Closed\n');
  }
}
