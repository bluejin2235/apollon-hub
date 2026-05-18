# APOLLON HUB

Next.js + Tailwind CSS + Supabase 기반의 팀 내부 포털 프로젝트입니다.

## 주요 기능

- 이메일/비밀번호 로그인 (Supabase Auth)
- 로그인 후 서비스 허브 진입
- 카드 그리드 기반 서비스 목록
  - Apollon License Manager
  - 아폴론 맛집
  - 추후 서비스 확장을 고려한 구조
- 심플/모던 다크톤 UI, 한국어 인터페이스

## 시작하기

1. 의존성 설치

```bash
npm install
```

2. 환경 변수 설정

`.env.example` 파일을 참고해서 `.env.local` 파일을 생성합니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_SECRET_KEY=your-supabase-secret-key
```

3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 열어 확인합니다.

## Vercel 배포

1. Vercel 프로젝트 생성 후 환경변수를 등록합니다.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (서버 전용, 클라이언트 노출 금지)
2. Vercel에서 GitHub 저장소를 연결하고 배포합니다.
3. 로컬에서 `vercel.json` 설정을 사용해 동일한 빌드 명령으로 배포됩니다.

## 폴더 구조

```text
apollon-os/
  app/
    hub/
      page.tsx
    globals.css
    layout.tsx
    page.tsx
  components/
    service-card.tsx
  lib/
    supabase/
      client.ts
  .env.example
  .gitignore
  eslint.config.mjs
  next.config.ts
  package.json
  postcss.config.mjs
  tailwind.config.ts
  tsconfig.json
```
