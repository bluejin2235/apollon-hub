// 통계 모듈이 그래프 부품을 거쳐 브라우저용 Supabase 클라이언트를 불러온다. 접속은 하지 않는다
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test";
