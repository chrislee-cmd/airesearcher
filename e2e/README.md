# e2e/ — PR preview QA 하네스

배포된 preview URL 의 **변경 표면만** 스모크하고 관전 증거 + 리포트를 남기는
Playwright 하네스. 전체 문서: [`docs/QA_HARNESS.md`](../docs/QA_HARNESS.md).

```
e2e/
├── global-setup.ts          # env 검증 + QA 계정 로그인 → storageState
├── global-teardown.ts       # surface 결과 + video/trace 합쳐 report.md/json
├── tests/
│   └── change-surface.spec.ts   # 변경 표면 순회 스모크 (전체 앱 X)
├── lib/
│   ├── config.ts            # env/QA 스크립트 로딩 + 변경 표면 도출 (secret 마스킹)
│   ├── auth.ts              # 로그인 헬퍼 (비번 미로깅)
│   └── report.ts            # 리포트 빌더 (read-only, 머지 X)
├── qa-script.example.json   # `## QA 스크립트` JSON 예시
└── artifacts/               # 생성물 (gitignore) — video/trace/스크린샷/리포트
```

⚠️ 이 하네스는 **read-only** 입니다 — PR/머지 상태를 바꾸지 않습니다.
⚠️ 로컬 dev 서버를 띄우지 않습니다 — 항상 원격 `QA_PREVIEW_URL` 대상.

실행: [`docs/QA_HARNESS.md#실행`](../docs/QA_HARNESS.md) 참고.
