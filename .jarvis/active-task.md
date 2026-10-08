# Active task — pr-chain-adoption-awaiting

이 worktree 는 **위젯 체인 B′ — advance 가 조립 완료(awaiting·커서 0) 체인을 채택해 running 승격 (approve 모드 L3→L4 성립)** 작업용입니다.

## SSOT 스펙
`/Users/meteorresearch/jarvis/workspaces/product-2/ai-researcher/tasks/pr-chain-adoption-awaiting.md`

워커 진입 시 위 파일을 먼저 읽고 작업하세요. 변경 파일/제약/검증 체크포인트가 모두 거기에 있습니다.

## 완료 시
- PR URL 보고
- `/wrap-up` 으로 `.jarvis/wrap-up.md` 갱신
- 마스터(jarvis) 가 `sync.sh` 로 머지 감지하면 spec status 를 done 으로 전환
