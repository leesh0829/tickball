import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { query } from './database.mjs'

const scryptAsync = promisify(scrypt)
const SESSION_COOKIE = 'tickball_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const AUTH_ATTEMPT_LIMIT = 20

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return []
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!key) return []
    try {
      return [[key, decodeURIComponent(value)]]
    } catch {
      return []
    }
  }))
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password.normalize('NFKC'), salt, 64)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password, storedHash) {
  const [, saltHex, hashHex] = String(storedHash || '').split('$')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function createSession(response, userId) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash(token), userId, expiresAt],
  )
  response.setHeader('Set-Cookie', sessionCookie(token))
}

export async function destroySession(request, response) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)])
  response.setHeader('Set-Cookie', sessionCookie('', 0))
}

export async function requireAuth(request, response, next) {
  try {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
    if (!token) {
      response.status(401).json({ message: '로그인이 필요합니다.' })
      return
    }
    const result = await query(`
      SELECT u.id, u.email, u.display_name, u.my_team, u.year_filter
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
    `, [tokenHash(token)])
    if (!result.rows[0]) {
      response.setHeader('Set-Cookie', sessionCookie('', 0))
      response.status(401).json({ message: '로그인 세션이 만료되었습니다.' })
      return
    }
    request.user = result.rows[0]
    next()
  } catch (error) {
    next(error)
  }
}

function authAttemptIdentifier(request) {
  const address = request.ip || request.socket.remoteAddress || 'unknown'
  return createHash('sha256').update(address).digest('hex')
}

export async function allowAuthAttempt(request, response, next) {
  try {
    const result = await query(`
      INSERT INTO auth_attempts (identifier, attempt_count, window_started_at)
      VALUES ($1, 1, NOW())
      ON CONFLICT (identifier) DO UPDATE SET
        attempt_count = CASE
          WHEN auth_attempts.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE auth_attempts.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN auth_attempts.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW()
          ELSE auth_attempts.window_started_at
        END
      RETURNING attempt_count
    `, [authAttemptIdentifier(request)])
    if (Number(result.rows[0]?.attempt_count) > AUTH_ATTEMPT_LIMIT) {
      response.setHeader('Retry-After', '900')
      response.status(429).json({ message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' })
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}

export async function clearAuthAttempts(request) {
  await query('DELETE FROM auth_attempts WHERE identifier = $1', [authAttemptIdentifier(request)])
}

export function newUserId() {
  return randomUUID()
}

export async function removeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= NOW()')
  await query("DELETE FROM auth_attempts WHERE window_started_at < NOW() - INTERVAL '1 day'")
}
