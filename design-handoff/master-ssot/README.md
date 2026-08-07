# MASTER SSOT — 읽는 법

> **CD SSOT:** `DESIGN-SSOT-MASTER.dc.html`. **작성:** Claude Design · 2026-08-06.
> **무엇인가:** 일곱 표면(Share Management · Share Shell · Widget Canvas · Fullview · Export Template · Deliverables Library · Picker System)이 각자 만들어 온 규격을 한자리에 놓고, **충돌하는 것만 판정한 파일**입니다.

## 1. 이 파일의 권한 — 좁습니다

| | |
|---|---|
| **§A 판정 6건** | **표면 스펙보다 우선합니다.** 각 표면 BUILD-SPEC 에 서로 다른 값으로 적혀 있던 것을 여기서 하나로 고른 것입니다. |
| **그 외 전부** | **표면 스펙이 계속 SSOT 입니다.** 여기 없는 값을 여기서 찾지 마세요 — 상태 전수 · 컴포넌트 계약 · 지오메트리는 각 번들에 있습니다. |
| **토큰 어휘** | **`tokens.json` 2.0 이 SSOT 입니다.** §B 는 그 파일을 눈으로 볼 수 있게 편 것이고, 새로 제안하는 값만 `NEW` 로 표시했습니다. |

**이 파일은 표면의 내용을 복제하지 않습니다.** §C 는 골격 다이어그램(비례만), §E 는 색인입니다. 실제 컴프와 상태 전수는 각 번들에서 보세요.

## 2. 판정 6건 요약

| # | 무엇 | 판정 |
|---|---|---|
| **A1** | 전면 프레임 radius 14 vs 16 | **16** (`rounded-panel-lg`) — 4:2 로 이미 다수, 2.0 토큰 역할과도 일치. 위젯 카드 20 은 유지 |
| **A2** | 헤더밴드 하단 보더 2px vs 3px | **역할로 분리** — 파스텔 밴드 = 2px, 흰 제품 헤더 = 3px. 예외 1건(observer 3px→2px) |
| **A3** | 같은 그림자에 이름 셋 | **`shadow-frame` 하나** — 값이 전부 같아 이름만 정리. `shadow-popover` 중복 승격도 병합 |
| **A4** | 보더 두께 7종 | **4단으로** — hair 1 / thin 1.5 / strong 2 / frame 3. 1.3·1.4·1.8·2.5 폐기 |
| **A5** | 아이콘 채움 = 톤 vs 흰색 | **바탕이 정한다** — 흰 바탕=톤 / 파스텔 타일=paper / ink 버튼=흰 스트로크 |
| **A6** | Picker radius 4종 off-scale | **2.0 눈금으로 흡수** — 5→4, 13→12, 나머지 둘은 이미 맞음. 진짜 갭 3건은 유효 |

**전부 기존 값 중 하나를 고른 것이고, 새 값을 만들지 않았습니다.**

> **§D6 닫기 · 제거 ✕** 는 판정이 아니라 컴포넌트 정합입니다 — 변종 4종(`row-remove` · `dialog-close` · `chip-clear` · `banner-dismiss`)과 두 가르는 축, 히트 영역 최소치를 요약합니다. 전체 토큰표와 마이그레이션 절차는 `close-button-BUILD-SPEC.md` 가 SSOT 입니다.

## 3. 반영 순서 (파일 하단에도 있음)

1. **이름만 정리 — 렌더 변화 0.** A3. 값이 같으므로 픽셀이 안 바뀝니다. 여기서 시작하세요.
2. **눈금 흡수 — 미세 변화.** A4 보더, A6 radius. 1px 이하라 **픽셀 diff 가 통과할 수 있습니다** — 눈이 아니라 grep 으로 확인하세요.
3. **눈에 보이는 변화.** A1 프레임 radius, A2 observer 헤더, A5 아이콘 채움. **표면 컴프도 같이 갱신**해야 픽셀 diff 가 의미를 갖습니다.
4. **별도 티켓.** `focus-ring` · `control-h-md/-sm` 승격, 아이콘 세트 3종 추가 + 채움값 정정. 규격 정리가 아니라 제품 전체의 구멍입니다.

## 4. 고쳐야 하는 파일 (판정별)

| 판정 | 고칠 곳 |
|---|---|
| A1 | `FULLVIEW-SHELL.md §F1` · `recruiting-scheduling-BUILD-SPEC §1` · `06-interview-results/GEOMETRY.md §B` |
| A2 | `interpreter-observer-BUILD-SPEC §1`(헤더밴드 3px→2px) |
| A3 | `FULLVIEW-SHELL.md §F6`(`--fv-frame-shadow` 삭제) · `interpreter-observer` · `recruiting-scheduling`(`shadow-fullview-frame` 삭제) · `06`/`07` BUILD-SPEC §2(`shadow-popover` 병합) |
| A4 | 전 표면 §1 클래스맵의 보더 칸 · `06-interview-results-BUILD-SPEC §1.3`(exec 블록 2.5→3) |
| A5 | `06-interview-results-BUILD-SPEC §1.5` · `07-share-management-BUILD-SPEC §1.10` — 두 규칙을 §A5 한 줄로 대체 |
| A6 | `picker-system-BUILD-SPEC §5`(off-scale 4종 표 갱신) |

## 5. 완료 판정

전부 반영하면 표면 전체에서 `rounded-\[` · `shadow-\[` · `border-\[` · raw hex 가 **0건**이어야 합니다. 남아 있으면 이 파일이 놓친 드리프트이고, CD 로 회부할 대상입니다.

## 6. 이 파일이 판정하지 않은 것

- **정체성 톤 배정** — 7종이 이미 1:1 배정 완료. 다음 기능은 예약된 톤이 없으니 새 파스텔을 만들지 말고 CD 로 회부하세요.
- **표면별 상태 전수 · 지오메트리 · 계약** — 각 번들 소관.
- **Export Template 의 인쇄 조판** — `export-documents-BUILD-SPEC.md` 가 문서 레이아웃 SSOT 이고 §A 영향이 없습니다.
- **`tokens.json` 자체의 개정** — §A 판정을 반영한 2.1 을 누가 언제 내는지는 별도 결정입니다. 이 파일은 판정만 하고 토큰 파일을 고치지 않았습니다.
