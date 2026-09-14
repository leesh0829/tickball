import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Database,
  House,
  LoaderCircle,
  LogOut,
  MapPin,
  Plus,
  Search,
  Settings,
  Trophy,
  X,
} from 'lucide-react'
import stadiumImage from './assets/stadium-night.png'
import ulsanWhalesEmblem from './assets/ulsan-whales-emblem.png'

type TeamKey = 'SSG' | '두산' | 'LG' | 'KT' | '롯데' | '한화' | 'KIA' | '삼성' | '키움' | 'NC' | '울산' | '고양' | '상무'
type MyTeamKey = Exclude<TeamKey, '고양' | '상무'>
type View = 'stats' | 'home' | 'settings'
type Result = 'win' | 'loss' | 'draw' | 'neutral'
type GameStatus = 'SCHEDULED' | 'LIVE' | 'FINAL' | 'CANCELED' | 'SUSPENDED'
type YearFilterValue = 'all' | 'current'

type AccountUser = {
  id: string
  email: string
  displayName: string
  myTeam: MyTeamKey
  yearFilter: YearFilterValue
}

type AccountPayload = {
  user: AccountUser
  games: Game[]
}

type Team = {
  key: TeamKey
  city: string
  short: string
  primary: string
  secondary: string
  foreground: string
  imageUrl?: string
}

type Game = {
  id: string | number
  sourceGameId?: string
  source?: 'NAVER' | 'KBO' | 'DEMO'
  league?: 'KBO' | 'FUTURES'
  date: string
  time?: string
  venue: string
  home: TeamKey
  away: TeamKey
  homeScore: number
  awayScore: number
  inning: string
  status?: GameStatus
  recordedVia?: 'ADD_MODAL'
  doubleheaderGame?: 1 | 2 | null
  homeEmblemUrl?: string | null
  awayEmblemUrl?: string | null
}

type HitterStat = {
  rank: number
  name: string
  position: string
  games: number
  atBats: number
  hits: number
  rbi: number
  runs: number
  homeRuns: number
  walks: number
  strikeouts: number
  average: string
  ops: string
  war: number | null
  playerImageUrl?: string | null
}

type PitcherStat = {
  rank: number
  name: string
  role: string
  games: number
  wins: number
  losses: number
  saves: number
  holds: number
  qualityStarts: number
  innings: string
  pitches: number
  hitsAllowed: number
  walksAllowed: number
  strikeouts: number
  runsAllowed: number
  earnedRuns: number
  era: string
  strikeoutsPerNine: string
  war: number | null
  playerImageUrl?: string | null
}

const TEAMS: Record<TeamKey, Team> = {
  SSG: { key: 'SSG', city: '인천', short: 'SSG', primary: '#CE0E2D', secondary: '#FFB81C', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/SK.png?type=f92_88' },
  두산: { key: '두산', city: '서울', short: 'DOO', primary: '#131230', secondary: '#ED1C24', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/OB.png?type=f92_88' },
  LG: { key: 'LG', city: '서울', short: 'LG', primary: '#C30452', secondary: '#000000', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/LG.png?type=f92_88' },
  KT: { key: 'KT', city: '수원', short: 'KT', primary: '#171717', secondary: '#EB1C24', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/KT.png?type=f92_88' },
  롯데: { key: '롯데', city: '부산', short: 'LOT', primary: '#041E42', secondary: '#D00F31', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/LT.png?type=f92_88' },
  한화: { key: '한화', city: '대전', short: 'HAN', primary: '#F15A24', secondary: '#111111', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/HH.png?type=f92_88' },
  KIA: { key: 'KIA', city: '광주', short: 'KIA', primary: '#EA0029', secondary: '#111111', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/HT.png?type=f92_88' },
  삼성: { key: '삼성', city: '대구', short: 'SL', primary: '#074CA1', secondary: '#C0C0C0', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/SS.png?type=f92_88' },
  키움: { key: '키움', city: '서울', short: 'KIW', primary: '#570514', secondary: '#D7B36A', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/WO.png?type=f92_88' },
  NC: { key: 'NC', city: '창원', short: 'NC', primary: '#315288', secondary: '#C7A079', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/NC.png?type=f92_88' },
  울산: { key: '울산', city: '울산', short: 'ULS', primary: '#141414', secondary: '#D71920', foreground: '#fff', imageUrl: ulsanWhalesEmblem },
  고양: { key: '고양', city: '고양', short: 'GO', primary: '#6D1D34', secondary: '#A88A59', foreground: '#fff', imageUrl: 'https://sports-phinf.pstatic.net/team/kbo/default/WO.png?type=f92_88' },
  상무: { key: '상무', city: '문경', short: 'SM', primary: '#1D5130', secondary: '#C5A55A', foreground: '#fff' },
}

const MY_TEAM_KEYS: MyTeamKey[] = ['SSG', '두산', 'LG', 'KT', '롯데', '한화', 'KIA', '삼성', '키움', 'NC', '울산']
const COPYRIGHT_NOTICE = '본 사이트는 상업적 목적이 없으며, 사용한 데이터 및 이미지의 모든 저작권은 KBO와 네이버 스포츠에 있습니다.'
const VENUE_GROUPS = [
  { label: 'KBO 1군', venues: ['인천 SSG랜더스필드', '잠실야구장', '수원 KT위즈파크', '부산 사직야구장', '대전 한화생명 볼파크', '광주 KIA챔피언스필드', '대구 삼성라이온즈파크', '고척스카이돔', '창원 NC파크'] },
  { label: '퓨처스리그', venues: ['울산 문수야구장', '강화 SSG퓨처스필드', '이천 베어스파크', '이천 LG챔피언스파크', '고양 국가대표야구훈련장', '문경 상무야구장', '익산 국가대표야구훈련장', '서산야구장', '상동야구장', '경산 볼파크', '함평 KIA챌린저스필드', '마산야구장'] },
]

function getResult(game: Game, myTeam: TeamKey): Result {
  const isMyGame = game.home === myTeam || game.away === myTeam
  if (game.homeScore === game.awayScore) return 'draw'
  const winner = game.homeScore > game.awayScore ? game.home : game.away
  if (!isMyGame) return 'neutral'
  return winner === myTeam ? 'win' : 'loss'
}

function getCardColor(game: Game, myTeam: TeamKey) {
  const result = getResult(game, myTeam)
  if (result === 'win') return TEAMS[myTeam].primary
  if (result === 'neutral') {
    const winner = game.homeScore > game.awayScore ? game.home : game.away
    return game.homeScore === game.awayScore ? '#30343b' : TEAMS[winner].primary
  }
  return '#30343b'
}

function resultLabel(result: Result) {
  return { win: 'WIN', loss: 'LOSS', draw: 'DRAW', neutral: 'WATCHED' }[result]
}

function formatPlayerPosition(rawPosition: string) {
  const positionNames: Record<string, string> = {
    포: '포수',
    一: '1루수',
    '1': '1루수',
    二: '2루수',
    '2': '2루수',
    三: '3루수',
    '3': '3루수',
    유: '유격수',
    좌: '좌익수',
    중: '중견수',
    우: '우익수',
    지: '지명타자',
  }
  return [...rawPosition]
    .flatMap((position) => positionNames[position] ? [positionNames[position]] : [])
    .filter((position, index, positions) => position !== positions[index - 1])
    .join(' → ')
}

function TeamMark({ team, light = false, imageUrl }: { team: TeamKey; light?: boolean; imageUrl?: string | null }) {
  const info = TEAMS[team]
  const source = imageUrl || info.imageUrl
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [source])

  return (
    <div className={`team-mark ${source && !imageFailed ? 'team-mark-image' : ''} ${light ? 'team-mark-light' : ''}`} style={{ '--team': info.primary, '--team-sub': info.secondary } as React.CSSProperties}>
      {source && !imageFailed
        ? <img src={source} alt={`${team} 엠블럼`} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        : <span>{info.short}</span>}
    </div>
  )
}

function PlayerIdentity({ name, imageUrl, detail }: { name: string; imageUrl?: string | null; detail?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [imageUrl])

  return (
    <div className="player-identity">
      <span className="player-photo">
        {imageUrl && !imageFailed
          ? <img src={imageUrl} alt={`${name} 선수`} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
          : <CircleUserRound size={25} aria-hidden="true" />}
      </span>
      <span><strong>{name}</strong>{detail ? <small>{detail}</small> : null}</span>
    </div>
  )
}

function gameEmblemUrl(game: Game, team: TeamKey) {
  if (game.home === team) return game.homeEmblemUrl
  if (game.away === team) return game.awayEmblemUrl
  return null
}

function Summary({ games, myTeam, yearFilter, currentYear }: { games: Game[]; myTeam: TeamKey; yearFilter: YearFilterValue; currentYear: number }) {
  const counts = games.reduce(
    (acc, game) => {
      const result = getResult(game, myTeam)
      if (result === 'win') acc.wins += 1
      if (result === 'loss') acc.losses += 1
      if (result === 'draw') acc.draws += 1
      return acc
    },
    { wins: 0, losses: 0, draws: 0 },
  )
  const decided = counts.wins + counts.losses
  const rate = decided ? Math.round((counts.wins / decided) * 100) : 0

  return (
    <header className="summary-shell">
      <div className="brand-row">
        <div className="brand"><span className="brand-ball" />tickball</div>
        <span className="season">{yearFilter === 'all' ? '전체 시즌' : `${currentYear} KBO`}</span>
      </div>
      <div className="summary-grid" aria-label="직관 경기 요약">
        <div><strong>{games.length}</strong><span>G</span><small>직관 경기</small></div>
        <div><strong>{counts.wins}</strong><span>W</span><small>승리</small></div>
        <div><strong>{counts.losses}</strong><span>L</span><small>패배</small></div>
        <div><strong>{rate}</strong><span>%</span><small>승률</small></div>
      </div>
    </header>
  )
}

function YearFilter({ value, currentYear, onChange }: { value: YearFilterValue; currentYear: number; onChange: (value: YearFilterValue) => void }) {
  return (
    <div className="year-filter" role="group" aria-label="직관 연도 범위">
      <button className={value === 'current' ? 'active' : ''} onClick={() => onChange('current')} aria-pressed={value === 'current'}>{currentYear}</button>
      <button className={value === 'all' ? 'active' : ''} onClick={() => onChange('all')} aria-pressed={value === 'all'}>전체 연도</button>
    </div>
  )
}

function GameCard({ game, myTeam, order }: { game: Game; myTeam: TeamKey; order: number }) {
  const result = getResult(game, myTeam)
  const myOnLeft = game.home === myTeam ? game.home : game.away === myTeam ? game.away : game.home
  const otherOnRight = myOnLeft === game.home ? game.away : game.home
  const leftScore = myOnLeft === game.home ? game.homeScore : game.awayScore
  const rightScore = otherOnRight === game.home ? game.homeScore : game.awayScore
  const bg = getCardColor(game, myTeam)

  return (
    <article className="game-row">
      <div className="timeline-point"><span>{order + 1}</span></div>
      <div className="game-card" style={{ '--card-color': bg } as React.CSSProperties}>
        <div className="card-topline">
          <span>{game.date.replaceAll('-', '.')} · {game.league === 'FUTURES' ? 'FUTURES' : 'KBO'}{game.doubleheaderGame ? ` · DH ${game.doubleheaderGame}차전` : ''}</span>
          <strong>{resultLabel(result)}</strong>
        </div>
        <div className="matchup">
          <div className="team-side">
            <TeamMark team={myOnLeft} imageUrl={gameEmblemUrl(game, myOnLeft)} light />
            <span>{myOnLeft}</span>
          </div>
          <div className="score-block">
            <div><strong>{leftScore}</strong><span>:</span><strong>{rightScore}</strong></div>
            <small>{game.inning}</small>
          </div>
          <div className="team-side">
            <TeamMark team={otherOnRight} imageUrl={gameEmblemUrl(game, otherOnRight)} light />
            <span>{otherOnRight}</span>
          </div>
        </div>
        <div className="venue"><MapPin size={14} />{game.venue}</div>
      </div>
    </article>
  )
}

function HomeView({ games, myTeam, onAdd, yearFilter, currentYear, onYearFilterChange }: { games: Game[]; myTeam: TeamKey; onAdd: () => void; yearFilter: YearFilterValue; currentYear: number; onYearFilterChange: (value: YearFilterValue) => void }) {
  const sortedGames = useMemo(
    () => [...games].sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date)
      if (dateOrder !== 0) return dateOrder
      return (b.time || '').localeCompare(a.time || '')
    }),
    [games],
  )

  return (
    <main className="content home-view">
      <div className="section-heading">
        <div><span>MY BALLPARK LOG</span><h1>나의 직관 기록</h1></div>
        <div className="team-chip"><TeamMark team={myTeam} /><span>{myTeam}</span></div>
      </div>
      <YearFilter value={yearFilter} currentYear={currentYear} onChange={onYearFilterChange} />
      <div className="game-list">
        {sortedGames.map((game, index) => <GameCard key={game.id} game={game} myTeam={myTeam} order={sortedGames.length - index - 1} />)}
      </div>
      {!games.length ? <section className="games-empty"><Trophy size={25} /><strong>{yearFilter === 'current' ? `${currentYear}년 직관 기록이 없습니다` : '아직 직관 기록이 없습니다'}</strong><span>경기 일자와 구장을 선택해 기록을 등록하세요.</span></section> : null}
      <button className="fab" onClick={onAdd} aria-label="직관 경기 추가" title="직관 경기 추가"><Plus size={27} /></button>
    </main>
  )
}

function StatsView({ games, myTeam, yearFilter, currentYear, onYearFilterChange }: { games: Game[]; myTeam: TeamKey; yearFilter: YearFilterValue; currentYear: number; onYearFilterChange: (value: YearFilterValue) => void }) {
  const [hitters, setHitters] = useState<HitterStat[]>([])
  const [pitchers, setPitchers] = useState<PitcherStat[]>([])
  const [startingPitchers, setStartingPitchers] = useState<PitcherStat[]>([])
  const [reliefPitchers, setReliefPitchers] = useState<PitcherStat[]>([])
  const [playerView, setPlayerView] = useState<'hitters' | 'pitchers'>('hitters')
  const [pitcherView, setPitcherView] = useState<'all' | 'starter' | 'relief'>('all')
  const [playersLoading, setPlayersLoading] = useState(true)
  const myGames = games.filter((g) => g.home === myTeam || g.away === myTeam)
  const wins = myGames.filter((g) => getResult(g, myTeam) === 'win').length
  const losses = myGames.filter((g) => getResult(g, myTeam) === 'loss').length
  const draws = myGames.filter((g) => getResult(g, myTeam) === 'draw').length
  const rate = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0
  const scoreTotals = myGames.reduce((total, game) => {
    const myScore = game.home === myTeam ? game.homeScore : game.awayScore
    const opponentScore = game.home === myTeam ? game.awayScore : game.homeScore
    return { for: total.for + myScore, against: total.against + opponentScore }
  }, { for: 0, against: 0 })
  const homeGames = myGames.filter((game) => game.home === myTeam)
  const awayGames = myGames.filter((game) => game.away === myTeam)
  const splitLabel = (targetGames: Game[]) => {
    const splitWins = targetGames.filter((game) => getResult(game, myTeam) === 'win').length
    const splitLosses = targetGames.filter((game) => getResult(game, myTeam) === 'loss').length
    const splitDraws = targetGames.filter((game) => getResult(game, myTeam) === 'draw').length
    return `${splitWins}승 ${splitLosses}패${splitDraws ? ` ${splitDraws}무` : ''}`
  }
  const opponentRecords = useMemo(() => {
    const records = new Map<TeamKey, { team: TeamKey; games: number; wins: number; losses: number; draws: number; runsFor: number; runsAgainst: number }>()
    myGames.forEach((game) => {
      const opponent = game.home === myTeam ? game.away : game.home
      const record = records.get(opponent) || { team: opponent, games: 0, wins: 0, losses: 0, draws: 0, runsFor: 0, runsAgainst: 0 }
      const result = getResult(game, myTeam)
      record.games += 1
      if (result === 'win') record.wins += 1
      if (result === 'loss') record.losses += 1
      if (result === 'draw') record.draws += 1
      record.runsFor += game.home === myTeam ? game.homeScore : game.awayScore
      record.runsAgainst += game.home === myTeam ? game.awayScore : game.homeScore
      records.set(opponent, record)
    })
    return [...records.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.team.localeCompare(b.team))
  }, [myGames, myTeam])

  useEffect(() => {
    const controller = new AbortController()
    setPlayersLoading(true)
    fetch('/api/stats/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yearFilter, currentYear }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message)
        setHitters(Array.isArray(payload.hitters) ? payload.hitters : [])
        setPitchers(Array.isArray(payload.pitchers) ? payload.pitchers : [])
        setStartingPitchers(Array.isArray(payload.startingPitchers) ? payload.startingPitchers : [])
        setReliefPitchers(Array.isArray(payload.reliefPitchers) ? payload.reliefPitchers : [])
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setHitters([])
          setPitchers([])
          setStartingPitchers([])
          setReliefPitchers([])
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlayersLoading(false)
      })
    return () => controller.abort()
  }, [currentYear, games, myTeam, yearFilter])

  const visiblePitchers = pitcherView === 'starter' ? startingPitchers : pitcherView === 'relief' ? reliefPitchers : pitchers

  return (
    <main className="content stats-view">
      <div className="page-title"><div><span>MY NUMBERS</span><h1>직관 통계</h1></div><BarChart3 size={25} /></div>
      <YearFilter value={yearFilter} currentYear={currentYear} onChange={onYearFilterChange} />
      <section className="stats-hero" style={{ '--stadium-image': `url(${stadiumImage})` } as React.CSSProperties}>
        <span>{TEAMS[myTeam].city} · {myTeam}</span>
        <h2>내가 가면<br /><strong>{rate}%</strong> 이긴다</h2>
        <p>{yearFilter === 'all' ? '전체 시즌' : currentYear} 직관 데이터</p>
      </section>
      <section className="stats-strip" aria-label="팀 직관 성적">
        <div><strong>{myGames.length}</strong><span>경기</span></div>
        <div><strong>{wins}</strong><span>승</span></div>
        <div><strong>{losses}</strong><span>패</span></div>
        <div><strong>{draws}</strong><span>무</span></div>
      </section>
      <section className="score-insights" aria-label="직관 득실 및 홈 원정 기록">
        <div><span>평균 득점</span><strong>{myGames.length ? (scoreTotals.for / myGames.length).toFixed(1) : '0.0'}</strong></div>
        <div><span>평균 실점</span><strong>{myGames.length ? (scoreTotals.against / myGames.length).toFixed(1) : '0.0'}</strong></div>
        <div><span>득실 차</span><strong>{scoreTotals.for - scoreTotals.against > 0 ? '+' : ''}{scoreTotals.for - scoreTotals.against}</strong></div>
        <div><span>홈 직관</span><strong>{splitLabel(homeGames)}</strong></div>
        <div><span>원정 직관</span><strong>{splitLabel(awayGames)}</strong></div>
      </section>
      <section className="opponent-section">
        <div className="subheading"><div><span>HEAD TO HEAD</span><h2>구단별 직관 상대 전적</h2></div></div>
        {opponentRecords.length ? <div className="opponent-list">{opponentRecords.map((record) => {
          const decided = record.wins + record.losses
          const opponentRate = decided ? Math.round((record.wins / decided) * 100) : 0
          return <div className="opponent-row" key={record.team}>
            <TeamMark team={record.team} />
            <div className="opponent-team"><strong>{record.team}</strong><span>{record.games}경기 · 득실 {record.runsFor}:{record.runsAgainst}</span></div>
            <div className="record-bar"><i style={{ width: `${opponentRate}%` }} /><span>{record.wins}승 {record.losses}패{record.draws ? ` ${record.draws}무` : ''}</span></div>
            <b>{opponentRate}%</b>
          </div>
        })}</div> : <div className="compact-empty">MY팀 직관 경기를 등록하면 상대 전적이 표시됩니다.</div>}
      </section>
      <section className="record-section">
        <div className="subheading"><div><span>MY TEAM PLAYERS</span><h2>직관 선수 랭킹</h2></div></div>
        <div className="player-tabs" role="group" aria-label="선수 기록 구분">
          <button className={playerView === 'hitters' ? 'active' : ''} onClick={() => setPlayerView('hitters')} aria-pressed={playerView === 'hitters'}>타자</button>
          <button className={playerView === 'pitchers' ? 'active' : ''} onClick={() => setPlayerView('pitchers')} aria-pressed={playerView === 'pitchers'}>투수</button>
        </div>
        {playerView === 'pitchers' ? <div className="pitcher-tabs" role="group" aria-label="투수 보직 구분">
          <button className={pitcherView === 'all' ? 'active' : ''} onClick={() => setPitcherView('all')} aria-pressed={pitcherView === 'all'}>전체</button>
          <button className={pitcherView === 'starter' ? 'active' : ''} onClick={() => setPitcherView('starter')} aria-pressed={pitcherView === 'starter'}>선발</button>
          <button className={pitcherView === 'relief' ? 'active' : ''} onClick={() => setPitcherView('relief')} aria-pressed={pitcherView === 'relief'}>불펜</button>
        </div> : null}
        {playersLoading ? <div className="stats-loading"><span className="spinner" />박스스코어 집계 중</div> : null}
        {!playersLoading && playerView === 'hitters' && hitters.length ? <div className="table-wrap">
          <table>
            <thead><tr><th>순위</th><th>선수</th><th>시즌 WAR</th><th>G</th><th>타율</th><th>OPS</th><th>안타</th><th>홈런</th><th>타점</th><th>득점</th><th>볼넷</th><th>삼진</th></tr></thead>
            <tbody>{hitters.map((player) => (
              <tr key={player.name}>
                <td><span className={player.rank === 1 ? 'rank-first' : ''}>{player.rank}</span></td>
                <td><PlayerIdentity name={player.name} imageUrl={player.playerImageUrl} detail={formatPlayerPosition(player.position)} /></td>
                <td>{player.war ?? '-'}</td><td>{player.games}</td><td>{player.average}</td><td>{player.ops}</td><td>{player.hits}</td><td>{player.homeRuns}</td><td>{player.rbi}</td><td>{player.runs}</td><td>{player.walks}</td><td>{player.strikeouts}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : null}
        {!playersLoading && playerView === 'pitchers' && visiblePitchers.length ? <div className="table-wrap">
          <table>
            <thead><tr><th>순위</th><th>투수</th><th>시즌 WAR</th><th>ERA</th><th>이닝</th><th>삼진</th><th>G</th><th>승</th><th>패</th><th>홀드</th><th>세</th><th>QS</th><th>K/9</th><th>피안타</th><th>4사구</th><th>투구수</th></tr></thead>
            <tbody>{visiblePitchers.map((player) => (
              <tr key={player.name}>
                <td><span className={player.rank === 1 ? 'rank-first' : ''}>{player.rank}</span></td>
                <td><PlayerIdentity name={player.name} imageUrl={player.playerImageUrl} detail={pitcherView !== 'all' ? player.role : null} /></td>
                <td>{player.war ?? '-'}</td><td>{player.era}</td><td>{player.innings}</td><td>{player.strikeouts}</td><td>{player.games}</td><td>{player.wins}</td><td>{player.losses}</td><td>{player.holds}</td><td>{player.saves}</td><td>{player.qualityStarts}</td><td>{player.strikeoutsPerNine}</td><td>{player.hitsAllowed}</td><td>{player.walksAllowed}</td><td>{player.pitches}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : null}
        {!playersLoading && ((playerView === 'hitters' && !hitters.length) || (playerView === 'pitchers' && !visiblePitchers.length)) ? <div className="player-empty"><Trophy size={22} /><strong>집계된 선수 기록이 없습니다</strong><span>실제 데이터로 등록한 MY팀 경기부터 집계됩니다.</span></div> : null}
      </section>
    </main>
  )
}

function SettingsView({ myTeam, user, onTeamChange, onLogout }: { myTeam: MyTeamKey; user: AccountUser; onTeamChange: (team: MyTeamKey) => void; onLogout: () => void }) {
  return (
    <main className="content settings-view">
      <div className="page-title"><div><span>PERSONALIZE</span><h1>MY 설정</h1></div><Settings size={25} /></div>
      <section className="profile-line">
        <div className="avatar"><CircleUserRound size={27} /></div>
        <div><strong>{user.displayName}</strong><span>{user.email}</span></div>
        <ChevronRight size={19} />
      </section>
      <section className="team-section">
        <div className="subheading"><div><span>THEME TEAM</span><h2>응원팀 선택</h2></div></div>
        <p>선택한 팀의 컬러가 승리 기록과 화면 테마에 적용됩니다.</p>
        <div className="team-grid">
          {MY_TEAM_KEYS.map((team) => (
            <button key={team} className={`team-option ${myTeam === team ? 'selected' : ''}`} onClick={() => onTeamChange(team)} aria-pressed={myTeam === team}>
              <TeamMark team={team} />
              <span>{team}</span>
              {myTeam === team ? <i><Check size={13} /></i> : null}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-list">
        <button><span><CalendarDays size={19} />시즌 설정</span><em>2026 KBO</em><ChevronRight size={18} /></button>
        <button><span><Database size={19} />기록 데이터</span><em>계정 DB 저장</em><ChevronRight size={18} /></button>
        <button className="logout-button" onClick={onLogout}><span><LogOut size={19} />로그아웃</span><ChevronRight size={18} /></button>
      </section>
      <footer className="copyright-notice">{COPYRIGHT_NOTICE}</footer>
    </main>
  )
}

function AddGameModal({ onClose, onAdd }: { onClose: () => void; onAdd: (games: Game[]) => Promise<void> }) {
  const [date, setDate] = useState(() => {
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 10)
  })
  const [venue, setVenue] = useState(VENUE_GROUPS[0].venues[0])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Game[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [selectedGameIds, setSelectedGameIds] = useState<string[]>([])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setSearched(false)
    setError('')
    setSelectedGameIds([])
    try {
      const params = new URLSearchParams({ date, venue })
      const response = await fetch(`/api/games/search?${params}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || '경기 결과를 가져오지 못했습니다.')
      const games = (payload.games as Array<Omit<Game, 'id' | 'home' | 'away'> & { home: string; away: string }>)
        .filter((game) => game.home in TEAMS && game.away in TEAMS)
        .map((game) => ({
          ...game,
          id: game.sourceGameId || `${game.date}-${game.away}-${game.home}`,
          home: game.home as TeamKey,
          away: game.away as TeamKey,
          homeScore: game.homeScore ?? 0,
          awayScore: game.awayScore ?? 0,
        }))
      setResults(games)
      if (payload.unavailableProviders?.length) {
        setError('일부 데이터 제공처가 응답하지 않아 검색 결과가 제한될 수 있습니다.')
      }
    } catch (requestError) {
      setResults([])
      setError(requestError instanceof Error ? requestError.message : '경기 결과를 가져오지 못했습니다.')
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }

  const toggleGame = (game: Game) => {
    if (game.status !== 'FINAL') return
    const id = String(game.id)
    setSelectedGameIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const addSelectedGames = async () => {
    const selected = results.filter((game) => selectedGameIds.includes(String(game.id)))
    if (!selected.length) return
    setSaving(true)
    setError('')
    try {
      await onAdd(selected)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '경기 기록을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head"><div><span>ADD GAME</span><h2 id="modal-title">직관 경기 등록</h2></div><button onClick={onClose} aria-label="닫기" title="닫기"><X size={21} /></button></div>
        <p>네이버 KBO와 KBO 퓨처스 공식 기록에서 경기를 찾아드려요.</p>
        <form onSubmit={submit}>
          <label><span>경기 일자</span><div className="input-shell"><CalendarDays size={18} /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div></label>
          <label><span>경기장</span><div className="input-shell"><MapPin size={18} /><select value={venue} onChange={(e) => setVenue(e.target.value)}>{VENUE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.venues.map((name) => <option key={name}>{name}</option>)}</optgroup>)}</select></div></label>
          <button className="search-game" type="submit" disabled={loading}>{loading ? <span className="spinner" /> : <Search size={18} />}{loading ? '경기 찾는 중' : '경기 검색'}</button>
        </form>
        {error ? <p className="search-notice">{error}</p> : null}
        {searched && !loading ? (
          <div className="search-results" aria-live="polite">
            {results.length ? results.map((game) => {
              const canAdd = game.status === 'FINAL'
              const selected = selectedGameIds.includes(String(game.id))
              return (
                <label key={game.id} className={`search-result ${selected ? 'selected' : ''} ${!canAdd ? 'disabled' : ''}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleGame(game)} disabled={!canAdd} />
                  <span className="source-badge">{game.league === 'FUTURES' ? '퓨처스' : 'KBO'}{game.doubleheaderGame ? ` · DH ${game.doubleheaderGame}차전` : ''}</span>
                  <span className="result-match"><TeamMark team={game.away} imageUrl={game.awayEmblemUrl} /><strong>{game.away}</strong><b>{canAdd ? game.awayScore : '-'}</b><i>:</i><b>{canAdd ? game.homeScore : '-'}</b><strong>{game.home}</strong><TeamMark team={game.home} imageUrl={game.homeEmblemUrl} /></span>
                  <span className="result-meta">{game.time} · {game.venue} · {canAdd ? '경기 종료' : game.inning}</span>
                  {!canAdd ? <small>종료된 경기만 등록할 수 있어요</small> : null}
                </label>
              )
            }) : <div className="empty-result"><Search size={20} /><strong>일치하는 경기가 없습니다</strong><span>일자와 경기장을 다시 확인해 주세요.</span></div>}
            {results.some((game) => game.status === 'FINAL') ? <button className="add-selected-games" type="button" onClick={addSelectedGames} disabled={!selectedGameIds.length || saving}>{saving ? 'DB에 저장 중' : `선택한 ${selectedGameIds.length || 0}경기 등록`}</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BottomNav({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const items: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: 'stats', label: '통계', icon: <BarChart3 size={21} /> },
    { id: 'home', label: '기록', icon: <House size={21} /> },
    { id: 'settings', label: 'MY', icon: <Settings size={21} /> },
  ]
  return <nav className="bottom-nav" aria-label="주 메뉴">{items.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => onChange(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
}

async function responsePayload(response: Response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || '요청을 처리하지 못했습니다.')
  return payload
}

async function loadAccount() {
  const response = await fetch('/api/account')
  if (response.status === 401) return null
  return responsePayload(response) as Promise<AccountPayload>
}

function AuthView({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      })
      await responsePayload(response)
      await onAuthenticated()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '계정 요청을 처리하지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const changeMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode)
    setError('')
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-labelledby="auth-title">
        <div className="auth-brand"><span className="brand-ball" />tickball</div>
        <div className="auth-heading"><span>MY BALLPARK ACCOUNT</span><h1 id="auth-title">직관 기록 계정</h1></div>
        <div className="auth-tabs" role="tablist" aria-label="계정 메뉴">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>로그인</button>
          <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')}>회원가입</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' ? <label><span>이름</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={30} autoComplete="name" required /></label> : null}
          <label><span>이메일</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="auth-spinner" size={18} /> : null}{submitting ? '처리 중' : mode === 'login' ? '로그인' : '계정 만들기'}</button>
        </form>
        <footer className="copyright-notice">{COPYRIGHT_NOTICE}</footer>
      </section>
    </main>
  )
}

function AppLoading() {
  return <main className="app-loading"><div className="auth-brand"><span className="brand-ball" />tickball</div><LoaderCircle className="auth-spinner" size={25} /><span>계정 기록 불러오는 중</span></main>
}

function TickballApp({ account, onLogout }: { account: AccountPayload; onLogout: () => Promise<void> }) {
  const currentYear = new Date().getFullYear()
  const [view, setView] = useState<View>('home')
  const [user, setUser] = useState(account.user)
  const [games, setGames] = useState(account.games)
  const [adding, setAdding] = useState(false)
  const myTeam = user.myTeam
  const yearFilter = user.yearFilter
  const theme = useMemo(() => TEAMS[myTeam], [myTeam])
  const filteredGames = useMemo(
    () => yearFilter === 'all' ? games : games.filter((game) => game.date.startsWith(`${currentYear}-`)),
    [currentYear, games, yearFilter],
  )

  const updateAccount = async (changes: { myTeam?: MyTeamKey; yearFilter?: YearFilterValue }) => {
    const response = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    const payload = await responsePayload(response)
    setUser(payload.user)
  }

  const changeTeam = async (team: MyTeamKey) => {
    const previousUser = user
    setUser((current) => ({ ...current, myTeam: team }))
    try {
      await updateAccount({ myTeam: team })
    } catch {
      setUser(previousUser)
    }
  }

  const changeYearFilter = async (value: YearFilterValue) => {
    const previousUser = user
    setUser((current) => ({ ...current, yearFilter: value }))
    try {
      await updateAccount({ yearFilter: value })
    } catch {
      setUser(previousUser)
    }
  }

  const addGames = async (selectedGames: Game[]) => {
    const response = await fetch('/api/attendances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: selectedGames }),
    })
    const payload = await responsePayload(response)
    setGames(payload.games)
  }

  return (
    <div className="app" style={{ '--accent': theme.primary, '--accent-2': theme.secondary, '--accent-fg': theme.foreground } as React.CSSProperties}>
      <Summary games={filteredGames} myTeam={myTeam} yearFilter={yearFilter} currentYear={currentYear} />
      {view === 'home' ? <HomeView games={filteredGames} myTeam={myTeam} onAdd={() => setAdding(true)} yearFilter={yearFilter} currentYear={currentYear} onYearFilterChange={(value) => { void changeYearFilter(value) }} /> : null}
      {view === 'stats' ? <StatsView games={filteredGames} myTeam={myTeam} yearFilter={yearFilter} currentYear={currentYear} onYearFilterChange={(value) => { void changeYearFilter(value) }} /> : null}
      {view === 'settings' ? <SettingsView myTeam={myTeam} user={user} onTeamChange={(team) => { void changeTeam(team) }} onLogout={() => { void onLogout() }} /> : null}
      <BottomNav view={view} onChange={setView} />
      {adding ? <AddGameModal onClose={() => setAdding(false)} onAdd={addGames} /> : null}
    </div>
  )
}

export default function App() {
  const [account, setAccount] = useState<AccountPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshAccount = useCallback(async () => {
    setLoading(true)
    try {
      setAccount(await loadAccount())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshAccount()
  }, [refreshAccount])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAccount(null)
  }

  if (loading) return <AppLoading />
  if (!account) return <AuthView onAuthenticated={refreshAccount} />
  return <TickballApp account={account} onLogout={logout} />
}
