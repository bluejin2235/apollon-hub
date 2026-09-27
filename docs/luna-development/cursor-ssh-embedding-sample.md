# Cursor에 전달할 SSH용 실행 요청

아래 작업은 회사 PC TJLEE의 Cursor Remote-SSH에서 실행해도 됩니다. NAS 파일을
읽지 않고 Hub DB에 이미 저장된 본문을 사용합니다. 완료한 NAS 접근/PPTX 검증은
반복하지 마세요.

1. 기존 `D:\Dev\apollon-hub`와 `D:\Dev\apollon-nas-scanner`, 미커밋 파일,
   Git 상태, DB, 스케줄러, 매핑을 변경하지 마세요.
2. `%TEMP%` 아래 새 폴더에 `bluejin2235/apollon-hub`를 별도 clone하고
   `64fc4f8f6d6bd51188e72e05d88dd3ac1857e8ec`를 detached checkout하세요.
   HEAD가 정확히 일치하는지 검사하세요. 필요한 의존성은 이 폴더에서만
   `npm ci --ignore-scripts --no-audit --no-fund`로 설치하세요.
3. 기존 Hub에 있는 정상적인 환경 설정만 현재 자식 프로세스에서 사용하세요.
   환경 파일을 복사하거나 수정하지 마세요. 키 값은 출력/채팅/명령 인수에
   넣지 마세요. 필요한 이름은 NEXT_PUBLIC_SUPABASE_URL,
   SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY,
   LUNA_OPENAI_API_KEY 또는 OPENAI_API_KEY입니다. 없으면 이름만 보고하세요.
4. 해당 설정이 `.env.local`에 있다면 현재 프로세스의 DOTENV_CONFIG_PATH에
   `D:\Dev\apollon-hub\.env.local` 경로만 지정하고 dotenv/config를 preload하여
   사용하세요. 기존 프로세스 설정을 덮어쓰지 말고 종료 후 원래 값으로 복원하세요.
5. 아래 dry-run을 먼저 실행하세요. 성공하면 사용자에게 중간 확인을 요청하지
   말고 동일 명령에 `--execute`만 붙여 **한 번** 실행하세요. 유료 호출이 실패하면
   자동 재시도하지 마세요. 실행당 임베딩 예상 상한 USD 0.01이며, 운영 DB 쓰기는
   없습니다. 별도 서비스 생성이나 배포는 하지 마세요.

```powershell
npx --yes tsx --require ./scripts/stub-server-only.cjs --require dotenv/config scripts/verify-nas-embedding-sample.ts --term=해운대 "--query=해운대스퀘어 제안의 핵심 내용과 연출 방향은?"
```

6. 결과로 HEAD, dry-run JSON, execute JSON, 종료 코드를 보고하세요.
   본문·키·전체 환경 변수는 출력하지 마세요. 오류가 나면 그 오류와 단계만
   보고하세요. 이 결과는 제한된 자료의 실제 임베딩/메모리 검색 검증이며,
   검색 품질 합격이나 전체 LUNA 개발 완료로 표현하지 마세요.

`index-nas-text.ts`, `embed-nas-chunks.ts --apply`, 스캐너, 전체 임베딩,
DB migration, 스케줄러 활성화, 운영 배포를 실행하지 마세요.
