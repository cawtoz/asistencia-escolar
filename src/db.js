const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "asistencia.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      date TEXT NOT NULL,
      open INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      student_id TEXT NOT NULL,
      name TEXT NOT NULL,
      time TEXT NOT NULL,
      UNIQUE(session_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      identifier TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all();
  if (!sessionColumns.some((column) => column.name === "started_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN started_at INTEGER");
  }
  if (!sessionColumns.some((column) => column.name === "late_minutes")) {
    db.exec("ALTER TABLE sessions ADD COLUMN late_minutes INTEGER");
  }
  const attendanceColumns = db.prepare("PRAGMA table_info(attendance)").all();
  if (!attendanceColumns.some((column) => column.name === "late")) {
    db.exec("ALTER TABLE attendance ADD COLUMN late INTEGER");
  }
  return db;
}

module.exports = { createDatabase };
