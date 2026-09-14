import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const serverDir = path.dirname(fileURLToPath(import.meta.url))
const defaultDataPath = path.resolve(serverDir, '../data/tickball.pglite')

let database
let databaseKind = 'pglite'

async function createDatabase() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_SIZE || 5),
    })
    if (process.env.VERCEL === '1') {
      const { attachDatabasePool } = await import('@vercel/functions')
      attachDatabasePool(pool)
    }
    databaseKind = 'postgres'
    return pool
  }

  if (process.env.VERCEL === '1') {
    throw new Error('DATABASE_URL must be configured for Vercel deployments.')
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const dataPath = path.resolve(process.env.TICKBALL_DB_PATH || defaultDataPath)
  await mkdir(path.dirname(dataPath), { recursive: true })
  return PGlite.create(dataPath)
}

export async function query(text, params = []) {
  if (!database) throw new Error('DATABASE_NOT_INITIALIZED')
  return database.query(text, params)
}

export async function initializeDatabase() {
  database = await createDatabase()
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      my_team TEXT NOT NULL DEFAULT 'SSG',
      year_filter TEXT NOT NULL DEFAULT 'current',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS year_filter TEXT NOT NULL DEFAULT 'current';

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS auth_attempts (
      identifier TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL,
      window_started_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS auth_attempts_window_idx
      ON auth_attempts(window_started_at);

    CREATE TABLE IF NOT EXISTS attendance_games (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_game_id TEXT NOT NULL,
      source TEXT NOT NULL,
      league TEXT NOT NULL,
      game_date DATE NOT NULL,
      game_time TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      inning TEXT NOT NULL,
      status TEXT NOT NULL,
      doubleheader_game INTEGER,
      home_emblem_url TEXT,
      away_emblem_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, source_game_id)
    );

    CREATE INDEX IF NOT EXISTS attendance_games_user_date_idx
      ON attendance_games(user_id, game_date DESC);
  `
  if (databaseKind === 'postgres') await database.query(schema)
  else await database.exec(schema)
  return databaseKind
}

export async function closeDatabase() {
  if (!database) return
  if (databaseKind === 'postgres') await database.end()
  else await database.close()
  database = null
}

export function getDatabaseKind() {
  return databaseKind
}
