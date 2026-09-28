import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import { QueueEntrySchema, makeQueueEntry, type QueueEntry } from '@agentic-qa/domain/queue';
import {
  WorkItemSnapshotSchema,
  type WorkItemSnapshot,
} from '@agentic-qa/domain/work-item';
import { QAContractSchema, type QAContract } from '@agentic-qa/domain/qa-contract';
import { ArtifactSchema, FindingSchema, ObservationSchema, QAReportSchema, RunManifestSchema, type Artifact, type Finding, type Observation, type QAReport, type RunManifest } from '@agentic-qa/domain/run';

const SCHEMA_VERSION = 4;
type CipherDatabaseConnection = BetterSqlite3.Database & {
  key(key: Buffer): number;
};
type CipherDatabaseConstructor = new (filename: string) => CipherDatabaseConnection;

export interface QaStoreOptions {
  databasePath: string;
  /** Returns a copy of the 256-bit database key, obtained from OS-protected storage. */
  key: () => Promise<Buffer> | Buffer;
  now?: () => string;
}

export interface QaStore {
  addToQueue(snapshot: WorkItemSnapshot): Promise<QueueEntry>;
  getQueue(): Promise<QueueEntry[]>;
  getSnapshot(key: string): Promise<WorkItemSnapshot | undefined>;
  markStale(key: string, stale: boolean): Promise<void>;
  removeFromQueue(key: string): Promise<void>;
  reorderQueue(keys: readonly string[]): Promise<void>;
  close(): Promise<void>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  saveContract(contract: QAContract): Promise<void>;
  createRun(manifest: RunManifest, contract: QAContract): Promise<void>;
  appendObservation(observation: Observation): Promise<void>;
  appendFinding(runId: string, finding: Finding): Promise<void>;
  finalizeRun(report: QAReport): Promise<void>;
  finalizeReview(report: QAReport): Promise<void>;
  getRun(runId: string): Promise<{ manifest: RunManifest; contract: QAContract; observations: Observation[]; findings: Finding[]; artifacts: Artifact[]; report?: QAReport; reviewedReport?: QAReport } | undefined>;
  listRuns(): Promise<Array<{ manifest: RunManifest; report?: QAReport }>>;
  deleteRun(runId: string): Promise<void>;
  deleteLocalQaData(): Promise<void>;
  recordArtifact(artifact: Artifact): Promise<void>;
  getArtifacts(runId: string): Promise<Artifact[]>;
}

interface QueueRow {
  key: string;
  organization: string;
  project_id: string;
  work_item_id: number;
  queued_at: string;
  stale: number;
}

function migrate(db: BetterSqlite3.Database): void {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version > SCHEMA_VERSION) {
    throw new Error(`QA storage schema ${version} is newer than this app supports`);
  }
  if (version < 1) {
    const migration = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        retrieved_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS queue_entries (
        key TEXT PRIMARY KEY REFERENCES work_items(key) ON DELETE CASCADE,
        organization TEXT NOT NULL,
        project_id TEXT NOT NULL,
        work_item_id INTEGER NOT NULL,
        queued_at TEXT NOT NULL,
        position INTEGER NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
        UNIQUE (organization, project_id, work_item_id)
      );
      CREATE INDEX IF NOT EXISTS queue_order_idx ON queue_entries(position);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);
      db.pragma('user_version = 1');
    });
    migration.immediate();
  }
  if (version < 2) {
    const migration = db.transaction(() => {
      db.exec(`
        CREATE TABLE qa_contracts (
          id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          contract_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id, revision)
        );
        CREATE TABLE run_records (
          run_id TEXT PRIMARY KEY,
          manifest_json TEXT NOT NULL,
          contract_id TEXT NOT NULL,
          contract_revision INTEGER NOT NULL,
          report_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (contract_id, contract_revision) REFERENCES qa_contracts(id, revision)
        );
        CREATE TABLE observations (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES run_records(run_id) ON DELETE CASCADE,
          observation_json TEXT NOT NULL
        );
        CREATE TABLE findings (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES run_records(run_id) ON DELETE CASCADE,
          finding_json TEXT NOT NULL
        );
        CREATE INDEX run_records_created_idx ON run_records(created_at DESC);
      `);
      db.pragma('user_version = 2');
    });
    migration.immediate();
  }
  if (version < 3) {
    const migration = db.transaction(() => {
      db.exec(`
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES run_records(run_id) ON DELETE CASCADE,
          artifact_json TEXT NOT NULL
        );
        CREATE INDEX artifacts_run_idx ON artifacts(run_id);
      `);
      db.pragma('user_version = 3');
    });
    migration.immediate();
  }
  if (version < 4) {
    const migration = db.transaction(() => {
      db.exec('ALTER TABLE run_records ADD COLUMN reviewed_report_json TEXT');
      db.pragma('user_version = 4');
    });
    migration.immediate();
  }
}

function rowToEntry(row: QueueRow): QueueEntry {
  return QueueEntrySchema.parse({
    key: row.key,
    organization: row.organization,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    queuedAt: row.queued_at,
    stale: row.stale === 1,
  });
}

function snapshotKey(snapshot: WorkItemSnapshot): string {
  return `${snapshot.organization.trim().toLocaleLowerCase('en-US')}:${snapshot.projectId.trim()}:${snapshot.id}`;
}

export async function openQaStore(options: QaStoreOptions): Promise<QaStore> {
  const suppliedKey = await options.key();
  const key = Buffer.from(suppliedKey);
  suppliedKey.fill(0);
  if (key.byteLength !== 32) {
    key.fill(0);
    throw new Error('QA database key must be exactly 32 bytes');
  }

  let db: CipherDatabaseConnection | undefined;
  try {
    const driverSpecifier = process.platform === 'win32'
      ? process.arch === 'arm64' ? 'better-sqlite3-multiple-ciphers/win32-arm64' : 'better-sqlite3-multiple-ciphers/win32-x64'
      : process.platform === 'darwin'
        ? process.arch === 'arm64' ? 'better-sqlite3-multiple-ciphers/darwin-arm64' : 'better-sqlite3-multiple-ciphers/darwin-x64'
        : process.arch === 'arm64' ? 'better-sqlite3-multiple-ciphers/linux-arm64' : 'better-sqlite3-multiple-ciphers/linux-x64';
    const cipherModule = await import(driverSpecifier) as { default: unknown };
    const Driver = cipherModule.default as CipherDatabaseConstructor;
    db = new Driver(options.databasePath);
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    db.key(key);
    const selectedCipher = db.pragma('cipher', { simple: true });
    if (selectedCipher !== 'sqlcipher') {
      throw new Error('SQLCipher-compatible encryption is unavailable');
    }
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    migrate(db);

    const addTransaction = db.transaction((snapshot: WorkItemSnapshot) => {
      const entry = makeQueueEntry(snapshot, (options.now ?? (() => new Date().toISOString()))());
      db!.prepare(`
        INSERT INTO work_items (key, payload_json, revision, retrieved_at)
        VALUES (@key, @payload, @revision, @retrievedAt)
        ON CONFLICT(key) DO UPDATE SET
          payload_json = excluded.payload_json,
          revision = excluded.revision,
          retrieved_at = excluded.retrieved_at
      `).run({
        key: entry.key,
        payload: JSON.stringify(snapshot),
        revision: snapshot.revision,
        retrievedAt: snapshot.retrievedAt,
      });

      const existing = db!.prepare('SELECT * FROM queue_entries WHERE key = ?').get(entry.key) as QueueRow | undefined;
      if (!existing) {
        const nextPositionRow = db!.prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM queue_entries',
        ).get() as { next: number } | undefined;
        const nextPosition = Number(nextPositionRow?.next ?? 0);
        db!.prepare(`
          INSERT INTO queue_entries
            (key, organization, project_id, work_item_id, queued_at, position, stale)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(
          entry.key,
          entry.organization,
          entry.projectId,
          entry.workItemId,
          entry.queuedAt,
          nextPosition,
        );
        return entry;
      }
      return rowToEntry(existing);
    });

    const getQueueStatement = db.prepare(
      'SELECT * FROM queue_entries ORDER BY position ASC, queued_at ASC',
    );
    const getSnapshotStatement = db.prepare(
      'SELECT payload_json FROM work_items WHERE key = ?',
    );
    const updateStaleStatement = db.prepare(
      'UPDATE queue_entries SET stale = ? WHERE key = ?',
    );
    const deleteEntryStatement = db.prepare('DELETE FROM queue_entries WHERE key = ?');
    const setPositionStatement = db.prepare(
      'UPDATE queue_entries SET position = ? WHERE key = ?',
    );
    const getSettingStatement = db.prepare('SELECT value_json FROM app_settings WHERE key = ?');
    const setSettingStatement = db.prepare(`
      INSERT INTO app_settings (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `);
    const saveContractStatement = db.prepare(`
      INSERT INTO qa_contracts (id, revision, contract_json) VALUES (?, ?, ?)
      ON CONFLICT(id, revision) DO NOTHING
    `);
    const createRunStatement = db.prepare(`
      INSERT INTO run_records (run_id, manifest_json, contract_id, contract_revision)
      VALUES (?, ?, ?, ?)
    `);
    const appendObservationStatement = db.prepare('INSERT INTO observations (id, run_id, observation_json) VALUES (?, ?, ?)');
    const appendFindingStatement = db.prepare('INSERT INTO findings (id, run_id, finding_json) VALUES (?, ?, ?)');
    const finalizeRunStatement = db.prepare('UPDATE run_records SET report_json = ? WHERE run_id = ? AND report_json IS NULL');
    const finalizeReviewStatement = db.prepare('UPDATE run_records SET reviewed_report_json = ? WHERE run_id = ? AND report_json IS NOT NULL');
    const selectRunStatement = db.prepare('SELECT manifest_json, contract_id, contract_revision, report_json, reviewed_report_json FROM run_records WHERE run_id = ?');
    const recordArtifactStatement = db.prepare('INSERT INTO artifacts (id, run_id, artifact_json) VALUES (?, ?, ?)');
    const deleteLocalQaData = db.transaction(() => {
      db!.exec('DELETE FROM queue_entries; DELETE FROM work_items; DELETE FROM run_records; DELETE FROM qa_contracts;');
      db!.prepare(`DELETE FROM app_settings WHERE key IN ('entra.selectedAccountId', 'ado.organization', 'ado.project', 'run.target') OR key LIKE 'ado.customTypeMappings.%' OR key LIKE 'run.target.%'`).run();
    });

    return {
      async addToQueue(input) {
        const snapshot = WorkItemSnapshotSchema.parse(input);
        return addTransaction(snapshot) as QueueEntry;
      },
      async getQueue() {
        return (getQueueStatement.all() as QueueRow[]).map(rowToEntry);
      },
      async getSnapshot(keyValue) {
        const row = getSnapshotStatement.get(keyValue) as
          | { payload_json: string }
          | undefined;
        if (!row) return undefined;
        return WorkItemSnapshotSchema.parse(JSON.parse(row.payload_json));
      },
      async markStale(keyValue, stale) {
        updateStaleStatement.run(stale ? 1 : 0, keyValue);
      },
      async removeFromQueue(keyValue) {
        deleteEntryStatement.run(keyValue);
      },
      async reorderQueue(keys) {
        const currentKeys = (getQueueStatement.all() as QueueRow[]).map(({ key }) => key);
        if (
          keys.length !== currentKeys.length ||
          new Set(keys).size !== keys.length ||
          keys.some((keyValue) => !currentKeys.includes(keyValue))
        ) {
          throw new Error('Queue order must contain every key exactly once');
        }
        const reorder = db!.transaction(() => {
          keys.forEach((keyValue, position) => {
            setPositionStatement.run(position, keyValue);
          });
        });
        reorder.immediate();
      },
      async getSetting(settingKey) {
        const row = getSettingStatement.get(settingKey) as
          | { value_json: string }
          | undefined;
        if (!row) return undefined;
        return JSON.parse(row.value_json);
      },
      async setSetting(settingKey, value) {
        if (!/^[A-Za-z][A-Za-z0-9._-]{0,100}$/.test(settingKey)) {
          throw new Error('Invalid setting key');
        }
        setSettingStatement.run(settingKey, JSON.stringify(value));
      },
      async saveContract(input) {
        const contract = QAContractSchema.parse(input);
        saveContractStatement.run(contract.id, contract.revision, JSON.stringify(contract));
        const stored = db!.prepare('SELECT contract_json FROM qa_contracts WHERE id = ? AND revision = ?').get(contract.id, contract.revision) as { contract_json: string } | undefined;
        if (!stored || stored.contract_json !== JSON.stringify(contract)) throw new Error('A contract revision is immutable once saved.');
      },
      async createRun(input, contractInput) {
        const manifest = RunManifestSchema.parse(input);
        const contract = QAContractSchema.parse(contractInput);
        if (manifest.contractId !== contract.id || manifest.contractRevision !== contract.revision) throw new Error('Run manifest and QA contract revisions must match.');
        const insert = db!.transaction(() => {
          saveContractStatement.run(contract.id, contract.revision, JSON.stringify(contract));
          const stored = db!.prepare('SELECT contract_json FROM qa_contracts WHERE id = ? AND revision = ?').get(contract.id, contract.revision) as { contract_json: string } | undefined;
          if (!stored || stored.contract_json !== JSON.stringify(contract)) throw new Error('A contract revision is immutable once saved.');
          createRunStatement.run(manifest.runId, JSON.stringify(manifest), contract.id, contract.revision);
        });
        insert.immediate();
      },
      async appendObservation(input) {
        const observation = ObservationSchema.parse(input);
        if (!selectRunStatement.get(observation.runId)) throw new Error('Run does not exist.');
        appendObservationStatement.run(observation.id, observation.runId, JSON.stringify(observation));
      },
      async appendFinding(runId, input) {
        const validatedRunId = z.string().uuid().parse(runId);
        const finding = FindingSchema.parse(input);
        if (!selectRunStatement.get(validatedRunId)) throw new Error('Run does not exist.');
        appendFindingStatement.run(finding.id, validatedRunId, JSON.stringify(finding));
      },
      async finalizeRun(input) {
        const report = QAReportSchema.parse(input);
        const result = finalizeRunStatement.run(JSON.stringify(report), report.runId);
        if (result.changes !== 1) throw new Error('Run is missing or its immutable report is already finalized.');
      },
      async finalizeReview(input) {
        const report = QAReportSchema.parse(input);
        const result = finalizeReviewStatement.run(JSON.stringify(report), report.runId);
        if (result.changes !== 1) throw new Error('Run must have an original report before review can be saved.');
      },
      async getRun(runId) {
        const row = selectRunStatement.get(runId) as { manifest_json: string; contract_id: string; contract_revision: number; report_json: string | null; reviewed_report_json: string | null } | undefined;
        if (!row) return undefined;
        const contractRow = db!.prepare('SELECT contract_json FROM qa_contracts WHERE id = ? AND revision = ?').get(row.contract_id, row.contract_revision) as { contract_json: string };
        const observations = db!.prepare('SELECT observation_json FROM observations WHERE run_id = ? ORDER BY rowid').all(runId) as Array<{ observation_json: string }>;
        const findings = db!.prepare('SELECT finding_json FROM findings WHERE run_id = ? ORDER BY rowid').all(runId) as Array<{ finding_json: string }>;
        const artifacts = db!.prepare('SELECT artifact_json FROM artifacts WHERE run_id = ? ORDER BY rowid').all(runId) as Array<{ artifact_json: string }>;
        return {
          manifest: RunManifestSchema.parse(JSON.parse(row.manifest_json)),
          contract: QAContractSchema.parse(JSON.parse(contractRow.contract_json)),
          observations: observations.map((item) => ObservationSchema.parse(JSON.parse(item.observation_json))),
          findings: findings.map((item) => FindingSchema.parse(JSON.parse(item.finding_json))),
          artifacts: artifacts.map((item) => ArtifactSchema.parse(JSON.parse(item.artifact_json))),
          ...(row.report_json ? { report: QAReportSchema.parse(JSON.parse(row.report_json)) } : {}),
          ...(row.reviewed_report_json ? { reviewedReport: QAReportSchema.parse(JSON.parse(row.reviewed_report_json)) } : {}),
        };
      },
      async listRuns() {
        const rows = db!.prepare('SELECT manifest_json, report_json, reviewed_report_json FROM run_records ORDER BY created_at DESC').all() as Array<{ manifest_json: string; report_json: string | null; reviewed_report_json: string | null }>;
        return rows.map((row) => ({ manifest: RunManifestSchema.parse(JSON.parse(row.manifest_json)), ...(row.reviewed_report_json ? { report: QAReportSchema.parse(JSON.parse(row.reviewed_report_json)) } : row.report_json ? { report: QAReportSchema.parse(JSON.parse(row.report_json)) } : {}) }));
      },
      async deleteRun(runId) {
        db!.prepare('DELETE FROM run_records WHERE run_id = ?').run(runId);
      },
      async deleteLocalQaData() {
        deleteLocalQaData.immediate();
      },
      async recordArtifact(input) {
        const artifact = ArtifactSchema.parse(input);
        if (!selectRunStatement.get(artifact.runId)) throw new Error('Run does not exist.');
        recordArtifactStatement.run(artifact.id, artifact.runId, JSON.stringify(artifact));
      },
      async getArtifacts(runId) {
        const rows = db!.prepare('SELECT artifact_json FROM artifacts WHERE run_id = ? ORDER BY rowid').all(z.string().uuid().parse(runId)) as Array<{ artifact_json: string }>;
        return rows.map(({ artifact_json }) => ArtifactSchema.parse(JSON.parse(artifact_json)));
      },
      async close() {
        if (db?.open) {
          db.pragma('wal_checkpoint(TRUNCATE)');
          db.close();
        }
      },
    };
  } catch {
    if (db?.open) db.close();
    throw new Error('Unable to unlock encrypted QA storage');
  } finally {
    key.fill(0);
  }
}
