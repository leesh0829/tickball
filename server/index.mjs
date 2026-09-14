import express from 'express'
import * as cheerio from 'cheerio'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  allowAuthAttempt,
  clearAuthAttempts,
  createSession,
  destroySession,
  hashPassword,
  newUserId,
  normalizeEmail,
  removeExpiredSessions,
  requireAuth,
  validEmail,
  verifyPassword,
} from './auth.mjs'
import { getDatabaseKind, initializeDatabase, query } from './database.mjs'

const app = express()
const port = Number(process.env.PORT || 4174)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; tickball/0.1; +http://localhost)',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
}
const NAVER_TEAM_CODES = {
  SSG: 'SK', '두산': 'OB', LG: 'LG', KT: 'KT', '롯데': 'LT', '한화': 'HH',
  KIA: 'HT', '삼성': 'SS', '키움': 'WO', NC: 'NC',
}
const TEAM_KEYS = new Set(['SSG', '두산', 'LG', 'KT', '롯데', '한화', 'KIA', '삼성', '키움', 'NC', '울산', '고양', '상무'])
const MY_TEAM_KEYS = new Set(['SSG', '두산', 'LG', 'KT', '롯데', '한화', 'KIA', '삼성', '키움', 'NC', '울산'])
const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json())

function readCache(key) {
  const entry = cache.get(key)
  if (!entry || Date.now() - entry.savedAt > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function writeCache(key, value) {
  cache.set(key, { savedAt: Date.now(), value })
  return value
}

function venueKey(value = '') {
  const venue = value.replaceAll(' ', '').toLowerCase()
  if (/ssg|문학|인천/.test(venue)) return '문학'
  if (/잠실/.test(venue)) return '잠실'
  if (/kt위즈|수원/.test(venue)) return '수원'
  if (/사직|부산/.test(venue)) return '사직'
  if (/한화생명|대전/.test(venue)) return '대전'
  if (/챔피언스|광주/.test(venue)) return '광주'
  if (/라이온즈|대구/.test(venue)) return '대구'
  if (/스카이돔|고척/.test(venue)) return '고척'
  if (/nc파크|창원/.test(venue)) return '창원'
  if (/문수|울산/.test(venue)) return '울산'
  return venue.replace(/[()]/g, '')
}

function cleanText(value = '') {
  return value.replace(/\s+/g, ' ').trim()
}

function mapNaverStatus(game) {
  if (game.cancel) return 'CANCELED'
  if (game.suspended) return 'SUSPENDED'
  if (game.statusCode === 'RESULT') return 'FINAL'
  if (['LIVE', 'STARTED', 'HALFTIME'].includes(game.statusCode)) return 'LIVE'
  return 'SCHEDULED'
}

function doubleheaderGameNumber(gameId) {
  const match = String(gameId || '').match(/^\d{8}[A-Z]{4}([12])\d{4}$/)
  return match ? Number(match[1]) : null
}

async function fetchNaverGames(date) {
  const cacheKey = `naver:${date}`
  const cached = readCache(cacheKey)
  if (cached) return cached

  const fields = [
    'gameId', 'categoryId', 'gameDate', 'gameDateTime', 'stadium',
    'homeTeamCode', 'homeTeamName', 'homeTeamScore', 'awayTeamCode',
    'awayTeamName', 'awayTeamScore', 'winner', 'statusCode', 'statusInfo',
    'cancel', 'suspended', 'homeTeamEmblemUrl', 'awayTeamEmblemUrl',
  ].join(',')
  const params = new URLSearchParams({
    categoryId: 'kbo', fromDate: date, toDate: date, size: '500', fields,
  })
  const url = `https://api-gw.sports.naver.com/schedule/games?${params}`
  const response = await fetch(url, {
    headers: { ...FETCH_HEADERS, Referer: 'https://m.sports.naver.com/' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`NAVER_${response.status}`)
  const payload = await response.json()
  if (!payload?.success || !Array.isArray(payload?.result?.games)) {
    throw new Error('NAVER_INVALID_RESPONSE')
  }

  const games = payload.result.games.map((game) => ({
    source: 'NAVER',
    sourceGameId: game.gameId,
    doubleheaderGame: doubleheaderGameNumber(game.gameId),
    sourceUrl: `https://m.sports.naver.com/game/${game.gameId}`,
    league: 'KBO',
    date: game.gameDate,
    time: game.gameDateTime?.slice(11, 16) || '',
    venue: game.stadium || '',
    home: game.homeTeamName,
    away: game.awayTeamName,
    homeScore: Number.isFinite(game.homeTeamScore) ? game.homeTeamScore : null,
    awayScore: Number.isFinite(game.awayTeamScore) ? game.awayTeamScore : null,
    status: mapNaverStatus(game),
    inning: game.statusInfo || (game.statusCode === 'RESULT' ? '경기 종료' : '경기 예정'),
    homeEmblemUrl: game.homeTeamEmblemUrl || null,
    awayEmblemUrl: game.awayTeamEmblemUrl || null,
  }))
  return writeCache(cacheKey, games)
}

function collectAspNetForm($) {
  const form = new URLSearchParams()
  $('form#mainForm input[type="hidden"][name]').each((_, element) => {
    const input = $(element)
    form.set(input.attr('name'), input.attr('value') || '')
  })
  return form
}

async function fetchFuturesMonth(year, month) {
  const cacheKey = `futures:${year}-${month}`
  const cached = readCache(cacheKey)
  if (cached) return cached

  const url = 'https://www.koreabaseball.com/Futures/Schedule/FuturesList.aspx'
  const initialResponse = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(8000),
  })
  if (!initialResponse.ok) throw new Error(`KBO_${initialResponse.status}`)
  let html = await initialResponse.text()
  let $ = cheerio.load(html)
  const selectedYear = $('#cphContents_cphContents_cphContents_ddlYear option:selected').val()
  const selectedMonth = $('#cphContents_cphContents_cphContents_ddlMonth option:selected').val()

  if (selectedYear !== year || selectedMonth !== month) {
    const form = collectAspNetForm($)
    const prefix = 'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$'
    form.set('__EVENTTARGET', `${prefix}btnSearch`)
    form.set('__EVENTARGUMENT', '')
    form.set(`${prefix}ddlYear`, year)
    form.set(`${prefix}ddlMonth`, month)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...FETCH_HEADERS,
        Referer: url,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`KBO_${response.status}`)
    html = await response.text()
    $ = cheerio.load(html)
  }

  const games = []
  let activeDate = ''
  $('.scheduleBoard tbody tr').each((_, element) => {
    const row = $(element)
    const dayText = cleanText(row.find('td.day').text())
    if (dayText) {
      const match = dayText.match(/(\d{2})\.(\d{2})/)
      if (match) activeDate = `${year}-${match[1]}-${match[2]}`
    }
    if (!activeDate) return

    const teamSpans = row.find('td.play > span')
    const away = cleanText(teamSpans.first().text())
    const home = cleanText(teamSpans.last().text())
    if (!away || !home || away === home) return

    const scores = row.find('td.play em > span').toArray()
      .map((score) => cleanText($(score).text()))
      .filter((score) => /^\d+$/.test(score))
      .map(Number)
    const time = cleanText(row.find('td.time').text())
    const venue = cleanText(row.find('td.ballpark').text())
    const note = cleanText(row.find('td.etc').text())
    const recordHref = row.find('td.relay a[href*="gameId="]').attr('href') || ''
    const gameId = new URL(recordHref || 'https://kbo.invalid', 'https://www.koreabaseball.com/Futures/Schedule/').searchParams.get('gameId')
      || `${activeDate}:${away}:${home}:${venue}:${time}`
    const canceled = /취소|중단|서스펜디드/.test(note)
    const status = canceled ? 'CANCELED' : scores.length === 2 ? 'FINAL' : 'SCHEDULED'

    games.push({
      source: 'KBO',
      sourceGameId: gameId,
      doubleheaderGame: doubleheaderGameNumber(gameId),
      sourceUrl: recordHref
        ? new URL(recordHref, 'https://www.koreabaseball.com/Futures/Schedule/').toString()
        : url,
      league: 'FUTURES',
      date: activeDate,
      time,
      venue,
      home,
      away,
      homeScore: scores.length === 2 ? scores[1] : null,
      awayScore: scores.length === 2 ? scores[0] : null,
      status,
      inning: status === 'FINAL' ? '경기 종료' : status === 'CANCELED' ? note : '경기 예정',
      homeEmblemUrl: null,
      awayEmblemUrl: null,
    })
  })

  return writeCache(cacheKey, games)
}

async function fetchFuturesGames(date) {
  const [year, month] = date.split('-')
  const games = await fetchFuturesMonth(year, month)
  return games.filter((game) => game.date === date)
}

function cellText(row, index) {
  return cleanText(row?.row?.[index]?.Text || '').replaceAll('&nbsp;', '')
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length
}

function inningsToOuts(value) {
  const match = String(value).match(/^(\d+)?\s*(?:([12])\/3)?$/)
  if (!match) return 0
  return (Number(match[1]) || 0) * 3 + (Number(match[2]) || 0)
}

function formatInnings(outs) {
  const innings = Math.floor(outs / 3)
  const remainder = outs % 3
  return `${innings}${remainder ? ` ${remainder}/3` : ''}`
}

async function fetchNaverStarterName(game) {
  if (game.league !== 'KBO') return null
  const cacheKey = `naver-starter:${game.sourceGameId}:${game.team}`
  const cached = readCache(cacheKey)
  if (cached) return cached

  const response = await fetch(`https://api-gw.sports.naver.com/schedule/games/${game.sourceGameId}/record`, {
    headers: { ...FETCH_HEADERS, Referer: 'https://m.sports.naver.com/' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`NAVER_RECORD_${response.status}`)
  const payload = await response.json()
  const record = payload?.result?.recordData
  if (!record) return null
  const isAway = game.away === game.team
  const starterCode = isAway ? record.gameInfo?.aPCode : record.gameInfo?.hPCode
  const pitchers = isAway ? record.pitchersBoxscore?.away : record.pitchersBoxscore?.home
  const starterName = Array.isArray(pitchers)
    ? pitchers.find((pitcher) => String(pitcher.pcode) === String(starterCode))?.name || null
    : null
  if (starterName) writeCache(cacheKey, starterName)
  return starterName
}

async function fetchSeasonWars(team, season) {
  const teamCode = NAVER_TEAM_CODES[team]
  if (!teamCode) return { hitters: new Map(), pitchers: new Map() }
  const cacheKey = `naver-war:${teamCode}:${season}`
  const cached = readCache(cacheKey)
  if (cached) return cached

  const fetchPlayers = async (playerType, field) => {
    const params = new URLSearchParams({
      teamCode,
      sortField: field,
      sortDirection: 'desc',
      page: '1',
      pageSize: '500',
      playerType,
    })
    const response = await fetch(`https://api-gw.sports.naver.com/statistics/categories/kbo/seasons/${season}/players?${params}`, {
      headers: { ...FETCH_HEADERS, Referer: 'https://m.sports.naver.com/' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`NAVER_STATS_${response.status}`)
    const payload = await response.json()
    const players = payload?.result?.seasonPlayerStats
    if (!Array.isArray(players)) throw new Error('NAVER_STATS_INVALID_RESPONSE')
    return new Map(players.flatMap((player) => {
      const war = Number(player[field])
      return player.playerName && Number.isFinite(war)
        ? [[player.playerName, { war, playerImageUrl: player.playerImageUrl || null }]]
        : []
    }))
  }

  const [hitters, pitchers] = await Promise.all([
    fetchPlayers('HITTER', 'hitterWar'),
    fetchPlayers('PITCHER', 'pitcherWar'),
  ])
  return writeCache(cacheKey, { hitters, pitchers })
}

async function fetchBoxScorePlayers(game) {
  const kboGameId = String(game.sourceGameId).slice(0, 13)
  const leagueId = game.league === 'FUTURES' ? '2' : '1'
  const cacheKey = `boxscore:${leagueId}:${kboGameId}:${game.team}`
  const cached = readCache(cacheKey)
  if (cached) return cached
  const starterNamePromise = fetchNaverStarterName(game).catch(() => null)

  const body = new URLSearchParams({
    leId: leagueId,
    srId: '0',
    seasonId: kboGameId.slice(0, 4),
    gameId: kboGameId,
  })
  const response = await fetch('https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll', {
    method: 'POST',
    headers: {
      ...FETCH_HEADERS,
      Referer: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`KBO_BOX_${response.status}`)
  const payload = await response.json()
  if (payload?.code !== '100' || !Array.isArray(payload.arrHitter)) {
    throw new Error('KBO_BOX_INVALID_RESPONSE')
  }

  const sideIndex = game.away === game.team ? 0 : game.home === game.team ? 1 : -1
  if (sideIndex < 0 || !payload.arrHitter[sideIndex]) return { hitters: [], pitchers: [] }
  const hitter = payload.arrHitter[sideIndex]
  const identityRows = JSON.parse(hitter.table1).rows || []
  const eventRows = JSON.parse(hitter.table2).rows || []
  const statRows = JSON.parse(hitter.table3).rows || []
  const hitters = identityRows.flatMap((row, index) => {
    const statRow = statRows[index]
    const name = cellText(row, 2)
    if (!name || !statRow) return []
    const events = (eventRows[index]?.row || []).map((cell) => cleanText(cell.Text || '').replaceAll('&nbsp;', '')).join(' ')
    return [{
      name,
      position: cellText(row, 1),
      atBats: Number(cellText(statRow, 0)) || 0,
      hits: Number(cellText(statRow, 1)) || 0,
      rbi: Number(cellText(statRow, 2)) || 0,
      runs: Number(cellText(statRow, 3)) || 0,
      doubles: countMatches(events, /(?:좌|중|우|좌중|우중|좌선|우선|중월)2/g),
      triples: countMatches(events, /(?:좌|중|우|좌중|우중|좌선|우선|중월)3/g),
      homeRuns: countMatches(events, /(?:홈런|홈)/g),
      walks: countMatches(events, /(?:고?4구)/g),
      hitByPitch: countMatches(events, /사구/g),
      strikeouts: countMatches(events, /삼진/g),
      sacrificeFlies: countMatches(events, /희비/g),
    }]
  })

  const pitcherRows = payload.arrPitcher?.[sideIndex]?.table
    ? JSON.parse(payload.arrPitcher[sideIndex].table).rows || []
    : []
  const starterName = await starterNamePromise
  const pitchers = pitcherRows.flatMap((row) => {
    const name = cellText(row, 0)
    if (!name) return []
    const decision = cellText(row, 2)
    const role = cellText(row, 1)
    const isStarter = starterName ? name === starterName : role === '선발'
    const outs = inningsToOuts(cellText(row, 6))
    const earnedRuns = Number(cellText(row, 15)) || 0
    return [{
      name,
      role: isStarter ? '선발' : '불펜',
      isStarter,
      wins: decision === '승' ? 1 : 0,
      losses: decision === '패' ? 1 : 0,
      saves: decision === '세' ? 1 : 0,
      holds: decision === '홀' ? 1 : 0,
      qualityStarts: isStarter && outs >= 18 && earnedRuns <= 3 ? 1 : 0,
      outs,
      battersFaced: Number(cellText(row, 7)) || 0,
      pitches: Number(cellText(row, 8)) || 0,
      hitsAllowed: Number(cellText(row, 10)) || 0,
      homeRunsAllowed: Number(cellText(row, 11)) || 0,
      walksAllowed: Number(cellText(row, 12)) || 0,
      strikeouts: Number(cellText(row, 13)) || 0,
      runsAllowed: Number(cellText(row, 14)) || 0,
      earnedRuns,
    }]
  })
  return writeCache(cacheKey, { hitters, pitchers })
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    myTeam: user.my_team,
    yearFilter: user.year_filter,
  }
}

function attendanceFromRow(row) {
  const gameDate = String(row.game_date_text ?? row.game_date).slice(0, 10)
  return {
    id: row.id,
    sourceGameId: row.source_game_id,
    source: row.source,
    league: row.league,
    date: gameDate,
    time: row.game_time,
    venue: row.venue,
    home: row.home_team,
    away: row.away_team,
    homeScore: row.home_score,
    awayScore: row.away_score,
    inning: row.inning,
    status: row.status,
    recordedVia: 'ADD_MODAL',
    doubleheaderGame: row.doubleheader_game,
    homeEmblemUrl: row.home_emblem_url,
    awayEmblemUrl: row.away_emblem_url,
  }
}

async function loadAttendances(userId, year = null) {
  const params = [userId]
  let yearClause = ''
  if (Number.isInteger(year)) {
    params.push(year)
    yearClause = 'AND EXTRACT(YEAR FROM game_date) = $2'
  }
  const result = await query(`
    SELECT attendance_games.*, game_date::text AS game_date_text
    FROM attendance_games
    WHERE user_id = $1 ${yearClause}
    ORDER BY game_date DESC, game_time DESC, created_at DESC
  `, params)
  return result.rows.map(attendanceFromRow)
}

function normalizedAttendance(game) {
  if (!game || typeof game !== 'object') return null
  const sourceGameId = typeof game.sourceGameId === 'string' ? game.sourceGameId.slice(0, 40) : ''
  const source = ['NAVER', 'KBO'].includes(game.source) ? game.source : game.league === 'FUTURES' ? 'KBO' : 'NAVER'
  const league = ['KBO', 'FUTURES'].includes(game.league) ? game.league : ''
  const home = typeof game.home === 'string' ? game.home : ''
  const away = typeof game.away === 'string' ? game.away : ''
  if (!sourceGameId || !league || !TEAM_KEYS.has(home) || !TEAM_KEYS.has(away) || !DATE_PATTERN.test(game.date || '')) return null
  if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) return null
  return {
    sourceGameId,
    source,
    league,
    date: game.date,
    time: typeof game.time === 'string' ? game.time.slice(0, 10) : '',
    venue: typeof game.venue === 'string' ? game.venue.slice(0, 100) : '',
    home,
    away,
    homeScore: Math.trunc(game.homeScore),
    awayScore: Math.trunc(game.awayScore),
    inning: typeof game.inning === 'string' ? game.inning.slice(0, 40) : '경기 종료',
    status: ['FINAL', 'CANCELED', 'SUSPENDED'].includes(game.status) ? game.status : 'FINAL',
    doubleheaderGame: [1, 2].includes(game.doubleheaderGame) ? game.doubleheaderGame : null,
    homeEmblemUrl: typeof game.homeEmblemUrl === 'string' ? game.homeEmblemUrl.slice(0, 500) : null,
    awayEmblemUrl: typeof game.awayEmblemUrl === 'string' ? game.awayEmblemUrl.slice(0, 500) : null,
  }
}

async function saveAttendances(userId, requestedGames) {
  const games = (Array.isArray(requestedGames) ? requestedGames : []).slice(0, 30).map(normalizedAttendance).filter(Boolean)
  if (!games.length) return []
  for (const game of games) {
    await query(`
      INSERT INTO attendance_games (
        id, user_id, source_game_id, source, league, game_date, game_time, venue,
        home_team, away_team, home_score, away_score, inning, status, doubleheader_game,
        home_emblem_url, away_emblem_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (user_id, source_game_id) DO UPDATE SET
        source = EXCLUDED.source,
        league = EXCLUDED.league,
        game_date = EXCLUDED.game_date,
        game_time = EXCLUDED.game_time,
        venue = EXCLUDED.venue,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        inning = EXCLUDED.inning,
        status = EXCLUDED.status,
        doubleheader_game = EXCLUDED.doubleheader_game,
        home_emblem_url = EXCLUDED.home_emblem_url,
        away_emblem_url = EXCLUDED.away_emblem_url,
        updated_at = NOW()
    `, [
      randomUUID(), userId, game.sourceGameId, game.source, game.league, game.date, game.time, game.venue,
      game.home, game.away, game.homeScore, game.awayScore, game.inning, game.status, game.doubleheaderGame,
      game.homeEmblemUrl, game.awayEmblemUrl,
    ])
  }
  return games
}

app.post('/api/auth/register', allowAuthAttempt, asyncRoute(async (request, response) => {
  const email = normalizeEmail(request.body?.email)
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim().slice(0, 30) : ''
  if (!validEmail(email)) {
    response.status(400).json({ message: '올바른 이메일 주소를 입력해 주세요.' })
    return
  }
  if (password.length < 8 || password.length > 128) {
    response.status(400).json({ message: '비밀번호는 8자 이상 128자 이하로 입력해 주세요.' })
    return
  }
  if (displayName.length < 2) {
    response.status(400).json({ message: '이름은 2자 이상 입력해 주세요.' })
    return
  }
  const userId = newUserId()
  try {
    await query(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
      [userId, email, await hashPassword(password), displayName],
    )
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ message: '이미 가입된 이메일입니다.' })
      return
    }
    throw error
  }
  await createSession(response, userId)
  await clearAuthAttempts(request)
  response.status(201).json({ user: { id: userId, email, displayName, myTeam: 'SSG', yearFilter: 'current' } })
}))

app.post('/api/auth/login', allowAuthAttempt, asyncRoute(async (request, response) => {
  const email = normalizeEmail(request.body?.email)
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const result = await query('SELECT * FROM users WHERE email = $1', [email])
  const user = result.rows[0]
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    response.status(401).json({ message: '이메일 또는 비밀번호를 확인해 주세요.' })
    return
  }
  await createSession(response, user.id)
  await clearAuthAttempts(request)
  response.json({ user: publicUser(user) })
}))

app.post('/api/auth/logout', asyncRoute(async (request, response) => {
  await destroySession(request, response)
  response.status(204).end()
}))

app.get('/api/account', requireAuth, asyncRoute(async (request, response) => {
  response.json({ user: publicUser(request.user), games: await loadAttendances(request.user.id) })
}))

app.patch('/api/account', requireAuth, asyncRoute(async (request, response) => {
  const myTeam = request.body?.myTeam === undefined ? request.user.my_team : request.body.myTeam
  const yearFilter = request.body?.yearFilter === undefined ? request.user.year_filter : request.body.yearFilter
  if (!MY_TEAM_KEYS.has(myTeam)) {
    response.status(400).json({ message: '지원하지 않는 응원팀입니다.' })
    return
  }
  if (!['current', 'all'].includes(yearFilter)) {
    response.status(400).json({ message: '지원하지 않는 연도 범위입니다.' })
    return
  }
  const result = await query(
    'UPDATE users SET my_team = $2, year_filter = $3, updated_at = NOW() WHERE id = $1 RETURNING id, email, display_name, my_team, year_filter',
    [request.user.id, myTeam, yearFilter],
  )
  response.json({ user: publicUser(result.rows[0]) })
}))

app.post('/api/attendances', requireAuth, asyncRoute(async (request, response) => {
  const saved = await saveAttendances(request.user.id, request.body?.games)
  if (!saved.length) {
    response.status(400).json({ message: '저장할 수 있는 경기 기록이 없습니다.' })
    return
  }
  response.status(201).json({ games: await loadAttendances(request.user.id) })
}))

app.delete('/api/attendances/:sourceGameId', requireAuth, asyncRoute(async (request, response) => {
  await query('DELETE FROM attendance_games WHERE user_id = $1 AND source_game_id = $2', [request.user.id, request.params.sourceGameId])
  response.status(204).end()
}))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, database: getDatabaseKind(), providers: ['NAVER_KBO', 'KBO_FUTURES'] })
})

app.get('/api/games/search', requireAuth, asyncRoute(async (request, response) => {
  const date = typeof request.query.date === 'string' ? request.query.date : ''
  const venue = typeof request.query.venue === 'string' ? request.query.venue.slice(0, 80) : ''
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+09:00`))) {
    response.status(400).json({ message: '올바른 경기 일자를 입력해 주세요.' })
    return
  }

  const providerResults = await Promise.allSettled([
    fetchNaverGames(date),
    fetchFuturesGames(date),
  ])
  const games = providerResults.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  const targetVenue = venueKey(venue)
  const matches = games
    .filter((game) => !targetVenue || venueKey(game.venue) === targetVenue)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
  const unavailableProviders = providerResults.flatMap((result, index) =>
    result.status === 'rejected' ? [index === 0 ? 'NAVER_KBO' : 'KBO_FUTURES'] : [],
  )

  if (unavailableProviders.length === 2) {
    response.status(502).json({ message: '경기 데이터 제공처에 연결할 수 없습니다.' })
    return
  }
  response.set('Cache-Control', 'private, max-age=60')
  response.json({ games: matches, unavailableProviders })
}))

app.post('/api/stats/players', requireAuth, asyncRoute(async (request, response) => {
  const team = request.user.my_team
  const requestedYear = request.body?.yearFilter === 'current' && Number.isInteger(request.body?.currentYear)
    ? request.body.currentYear
    : null
  const requestedGames = await loadAttendances(request.user.id, requestedYear)
  const games = requestedGames.flatMap((game) => {
    if (!game || !['KBO', 'FUTURES'].includes(game.league)) return []
    if (typeof game.sourceGameId !== 'string' || !/^\d{8}[A-Z]{4}\d/.test(game.sourceGameId)) return []
    if (typeof game.home !== 'string' || typeof game.away !== 'string') return []
    if (game.home !== team && game.away !== team) return []
    return [{
      sourceGameId: game.sourceGameId,
      league: game.league,
      home: game.home,
      away: game.away,
      team,
    }]
  })
  if (!games.length) {
    response.json({ hitters: [], pitchers: [], startingPitchers: [], reliefPitchers: [], gameCount: 0, unavailableGameCount: 0 })
    return
  }

  const seasons = [...new Set(games.filter((game) => game.league === 'KBO').map((game) => String(game.sourceGameId).slice(0, 4)))]
    .sort((a, b) => b.localeCompare(a))
  const [boxScores, seasonWarResults] = await Promise.all([
    Promise.allSettled(games.map(fetchBoxScorePlayers)),
    Promise.allSettled(seasons.map((season) => fetchSeasonWars(team, season))),
  ])
  const hitterProfiles = new Map()
  const pitcherProfiles = new Map()
  const mergeProfiles = (target, profiles) => profiles.forEach((profile, name) => {
    const current = target.get(name) || { war: 0, playerImageUrl: null }
    current.war += profile.war
    current.playerImageUrl ||= profile.playerImageUrl
    target.set(name, current)
  })
  seasonWarResults.forEach((result) => {
    if (result.status !== 'fulfilled') return
    mergeProfiles(hitterProfiles, result.value.hitters)
    mergeProfiles(pitcherProfiles, result.value.pitchers)
  })
  const hitterAggregate = new Map()
  const pitcherAggregate = new Map()
  const startingPitcherAggregate = new Map()
  const reliefPitcherAggregate = new Map()
  const aggregatePitcher = (target, player) => {
    const current = target.get(player.name) || {
      name: player.name, role: player.role, games: 0, wins: 0, losses: 0, saves: 0, holds: 0,
      qualityStarts: 0, outs: 0, battersFaced: 0, pitches: 0, hitsAllowed: 0,
      homeRunsAllowed: 0, walksAllowed: 0, strikeouts: 0, runsAllowed: 0, earnedRuns: 0,
    }
    current.games += 1
    ;['wins', 'losses', 'saves', 'holds', 'qualityStarts', 'outs', 'battersFaced', 'pitches', 'hitsAllowed', 'homeRunsAllowed', 'walksAllowed', 'strikeouts', 'runsAllowed', 'earnedRuns']
      .forEach((key) => { current[key] += player[key] })
    target.set(player.name, current)
  }
  boxScores.forEach((result) => {
    if (result.status !== 'fulfilled') return
    const appearedHitters = new Set()
    result.value.hitters.forEach((player) => {
      const current = hitterAggregate.get(player.name) || {
        name: player.name, position: player.position, games: 0, atBats: 0, hits: 0, rbi: 0, runs: 0,
        doubles: 0, triples: 0, homeRuns: 0, walks: 0, hitByPitch: 0, strikeouts: 0, sacrificeFlies: 0,
      }
      if (!appearedHitters.has(player.name)) {
        current.games += 1
        appearedHitters.add(player.name)
      }
      current.position = player.position || current.position
      ;['atBats', 'hits', 'rbi', 'runs', 'doubles', 'triples', 'homeRuns', 'walks', 'hitByPitch', 'strikeouts', 'sacrificeFlies']
        .forEach((key) => { current[key] += player[key] })
      hitterAggregate.set(player.name, current)
    })

    result.value.pitchers.forEach((player) => {
      aggregatePitcher(pitcherAggregate, player)
      aggregatePitcher(player.isStarter ? startingPitcherAggregate : reliefPitcherAggregate, player)
    })
  })
  const hitters = [...hitterAggregate.values()]
    .map((player) => {
      const profile = hitterProfiles.get(player.name)
      return {
        ...player,
        war: profile ? Number(profile.war.toFixed(2)) : null,
        playerImageUrl: profile?.playerImageUrl || null,
        average: player.atBats ? (player.hits / player.atBats).toFixed(3).replace(/^0/, '') : '.000',
        ops: (() => {
        const singles = Math.max(0, player.hits - player.doubles - player.triples - player.homeRuns)
        const totalBases = singles + player.doubles * 2 + player.triples * 3 + player.homeRuns * 4
        const onBaseDenominator = player.atBats + player.walks + player.hitByPitch + player.sacrificeFlies
        const onBase = onBaseDenominator ? (player.hits + player.walks + player.hitByPitch) / onBaseDenominator : 0
        const slugging = player.atBats ? totalBases / player.atBats : 0
        return (onBase + slugging).toFixed(3).replace(/^0/, '')
        })(),
      }
    })
    .sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity) || Number(b.ops) - Number(a.ops) || b.hits - a.hits || b.rbi - a.rbi)
    .map((player, index) => ({ ...player, rank: index + 1 }))

  const finalizePitchers = (aggregate) => [...aggregate.values()]
    .map((player) => {
      const profile = pitcherProfiles.get(player.name)
      const war = profile ? Number(profile.war.toFixed(2)) : null
      return {
        ...player,
        war,
        playerImageUrl: profile?.playerImageUrl || null,
        innings: formatInnings(player.outs),
        era: player.outs ? ((player.earnedRuns * 27) / player.outs).toFixed(2) : '-',
        strikeoutsPerNine: player.outs ? ((player.strikeouts * 27) / player.outs).toFixed(1) : '-',
      }
    })
    .sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)
      || (Number.isFinite(Number(a.era)) ? Number(a.era) : Infinity) - (Number.isFinite(Number(b.era)) ? Number(b.era) : Infinity)
      || b.outs - a.outs
      || b.strikeouts - a.strikeouts)
    .map((player, index) => ({ ...player, rank: index + 1 }))

  const pitchers = finalizePitchers(pitcherAggregate)
  const startingPitchers = finalizePitchers(startingPitcherAggregate)
  const reliefPitchers = finalizePitchers(reliefPitcherAggregate)

  response.json({
    hitters,
    pitchers,
    startingPitchers,
    reliefPitchers,
    gameCount: games.length,
    unavailableGameCount: boxScores.filter((result) => result.status === 'rejected').length,
  })
}))

if (process.env.VERCEL !== '1') {
  const distDir = path.join(rootDir, 'dist')
  app.use(express.static(distDir))
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) return next()
    response.sendFile(path.join(distDir, 'index.html'), (error) => error && next())
  })
}

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ message: '서버에서 요청을 처리하지 못했습니다.' })
})

export const databaseReady = (async () => {
  const databaseKind = await initializeDatabase()
  await removeExpiredSessions()
  return databaseKind
})()

if (process.env.VERCEL !== '1') {
  try {
    const databaseKind = await databaseReady
  app.listen(port, '0.0.0.0', () => {
    console.log(`tickball API listening on http://localhost:${port} (${databaseKind})`)
  })
  } catch (error) {
    console.error('tickball database initialization failed', error)
    process.exitCode = 1
  }
}

export default app
