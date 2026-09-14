# tickball

KBO 및 퓨처스 직관 기록과 계정별 통계를 관리하는 React + Express 애플리케이션입니다.

## 데이터 출처 및 저작권

| 데이터 | 출처 |
| --- | --- |
| KBO 1군 일정, 점수, 경기 상태, 구장, 팀 엠블럼 | 네이버 스포츠 |
| 선발투수, 시즌 WAR, 선수 이미지 | 네이버 스포츠 |
| 퓨처스리그 일정 및 경기 결과 | KBO 공식 홈페이지 |
| 타자·투수 경기별 박스스코어 | KBO 공식 홈페이지 |

사용 중인 데이터 엔드포인트는 다음과 같습니다.

```text
https://api-gw.sports.naver.com/schedule/games
https://api-gw.sports.naver.com/schedule/games/{gameId}/record
https://api-gw.sports.naver.com/statistics/categories/kbo/seasons/{season}/players
https://www.koreabaseball.com/Futures/Schedule/FuturesList.aspx
https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll
```

네이버 스포츠와 KBO 홈페이지 내부에서 사용하는 엔드포인트이므로 응답 형식이나 제공 여부가 예고 없이 변경될 수 있습니다.

> 본 프로젝트는 상업적 목적이 없으며, 사용한 데이터 및 이미지의 모든 저작권은 KBO와 네이버 스포츠에 있습니다.

## 로컬 실행

Node.js 24 기준입니다. 별도 데이터베이스 설치 없이 PGlite가 `data/tickball.pglite`에 로컬 PostgreSQL 데이터를 생성합니다.

```bash
npm install
npm run dev
```

- 웹: `http://localhost:5173`
- API 및 프로덕션 빌드 실행: `http://localhost:4174`

## Vercel 배포

운영에서는 Vercel Marketplace의 Neon PostgreSQL 같은 관리형 PostgreSQL을 연결합니다. Vercel 프로젝트의 Production과 Preview 환경에 아래 값을 등록합니다.

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE
DATABASE_SSL=true
DATABASE_POOL_SIZE=5
NODE_ENV=production
```

`vercel.json`은 `/api/*`를 하나의 Express Function으로 보내고, Vite 결과물은 CDN에서 제공합니다. Vercel에서 `DATABASE_URL`이 없으면 임시 파일 DB로 실행하지 않고 즉시 실패하도록 구성했습니다.

```bash
npx vercel link
npx vercel env pull .env.local
npx vercel deploy
```

서버가 시작될 때 사용자, 로그인 세션, 인증 시도, 직관 경기 테이블과 인덱스를 준비합니다. `DATABASE_URL`이 없을 때 사용하는 PGlite는 로컬 개발 전용입니다.

## 저장 구조

- `users`: 이메일, 암호화된 비밀번호, 이름, MY팀, 연도 보기 설정
- `sessions`: 해시 처리된 로그인 세션과 만료 시각
- `auth_attempts`: 여러 서버 인스턴스가 공유하는 로그인 시도 제한
- `attendance_games`: 사용자별 직관 경기 결과

브라우저 `localStorage`는 사용하지 않습니다. MY팀, 연도 보기 설정, 직관 기록은 모두 로그인 사용자 기준으로 PostgreSQL에 저장됩니다. 비밀번호는 Node.js `scrypt`로 솔트와 함께 해시하고, 로그인 토큰은 원문 대신 SHA-256 해시만 DB에 저장합니다. 세션 쿠키는 `HttpOnly`, `SameSite=Lax`이며 프로덕션에서는 `Secure`가 추가됩니다.
