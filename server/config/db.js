import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbClient = (process.env.DB_CLIENT || '').toLowerCase();

const sqliteConflictColumns = {
  ai_assessments: ['attempt_id'],
  violation_heatmap: ['exam_id', 'attempt_id', 'violation_type', 'time_bucket_minutes']
};

const shouldUseSqlite = dbClient === 'sqlite' || (!process.env.DB_HOST && !process.env.DB_NAME);

const transformUpsertQueryForSqlite = (sql) => {
  if (!/ON DUPLICATE KEY UPDATE/i.test(sql)) return sql;

  const insertMatch = sql.match(/INSERT\s+INTO\s+([^\s(]+)/i);
  const tableName = insertMatch?.[1]?.replace(/[`'"]/g, '');
  const conflictColumns = sqliteConflictColumns[tableName];
  if (!tableName || !conflictColumns) return sql;

  return sql.replace(
    /ON DUPLICATE KEY UPDATE\s+([\s\S]+)$/i,
    (_, updates) => {
      const transformedUpdates = updates.replace(/VALUES\s*\(\s*([a-zA-Z0-9_]+)\s*\)/g, 'excluded.$1');
      return `ON CONFLICT(${conflictColumns.join(', ')}) DO UPDATE SET ${transformedUpdates}`;
    }
  );
};

const createSqliteCompat = () => {
  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../database/smart_exam.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');

  const normalizeSql = (sql) => transformUpsertQueryForSqlite(sql.trim());

  const runStatement = (sql, params = []) => {
    const normalizedSql = normalizeSql(sql);
    const statement = sqlite.prepare(normalizedSql);

    if (/^\s*(select|pragma)\b/i.test(normalizedSql)) {
      return [statement.all(...params)];
    }

    const result = statement.run(...params);
    return [{
      insertId: Number(result.lastInsertRowid || 0),
      affectedRows: result.changes,
      changes: result.changes
    }];
  };

  const createConnection = () => ({
    async query(sql, params = []) {
      return runStatement(sql, params);
    },
    async beginTransaction() {
      sqlite.exec('BEGIN');
    },
    async commit() {
      sqlite.exec('COMMIT');
    },
    async rollback() {
      sqlite.exec('ROLLBACK');
    },
    release() {}
  });

  return {
    async query(sql, params = []) {
      return runStatement(sql, params);
    },
    async getConnection() {
      return createConnection();
    }
  };
};

const createMysqlPool = () => mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

const pool = shouldUseSqlite ? createSqliteCompat() : createMysqlPool();

const ensureQuestionBankColumns = async () => {
  const connection = await pool.getConnection();
  try {
    if (shouldUseSqlite) {
      const [columns] = await connection.query('PRAGMA table_info(question_bank)');
      const columnNames = new Set(columns.map((column) => column.name));
      if (!columnNames.has('sample_answer')) {
        await connection.query('ALTER TABLE question_bank ADD COLUMN sample_answer TEXT');
      }
      if (!columnNames.has('grading_keywords')) {
        await connection.query('ALTER TABLE question_bank ADD COLUMN grading_keywords TEXT');
      }
    } else {
      const [sampleAnswerColumns] = await connection.query("SHOW COLUMNS FROM question_bank LIKE 'sample_answer'");
      if (!sampleAnswerColumns.length) {
        await connection.query('ALTER TABLE question_bank ADD COLUMN sample_answer TEXT');
      }

      const [gradingKeywordColumns] = await connection.query("SHOW COLUMNS FROM question_bank LIKE 'grading_keywords'");
      if (!gradingKeywordColumns.length) {
        await connection.query('ALTER TABLE question_bank ADD COLUMN grading_keywords TEXT');
      }
    }
  } catch (error) {
    console.error('Question bank schema upgrade failed:', error.message);
  } finally {
    connection.release();
  }
};

// Test connection and ensure schema readiness on startup
export const dbReady = (async () => {
  try {
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    console.log(`Database connected successfully (${shouldUseSqlite ? 'sqlite' : 'mysql'})`);
    connection.release();
    await ensureQuestionBankColumns();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
})();

export default pool;
