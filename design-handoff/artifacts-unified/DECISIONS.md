# DECISIONS — artifacts-unified (writer 기록, 사용자 확정)

> **2026-07-28 · 사용자 확정.** CD 번들(from-cd/, 2026-07-28)의 `⚠️ contract-change` 및 CD 결정 항목에 대한 제품 결정. **이 파일이 결정 SSOT** — 배선 스펙과 CD 후속 작업 양쪽이 이걸 따른다.

## 사용자 결정 3건

### D1. `not_found` = `deleted` 동일 화면 — **✅ A안 채택 (CD안 수용)**
공개 페이지는 토큰이 원래 존재했는지 확인해주지 않는다(정보 노출 방지). 둘 다 B3c(dashed 🔗 "찾을 수 없음") 렌더. 별도 "삭제됨" 문구 없음.

### D2. 공유자 실명 노출 — **✅ C안: 표시하지 않음**
공개 공유 페이지에 개인 이름("Shared by 김연구")을 **표시하지 않는다.**
- **계약 델타**: `ShareShellProps.sharedBy` → **제거** (또는 미사용). attribution 줄은 **공유일 + 만료만**: "Shared 2026-07-28 · 만료 8월 4일".
- **CD 후속**: masthead attribution 줄에서 이름 제거 (한 줄 수정 — 레이아웃 영향 없음). 별도 리비전 번들 불요, 워커가 이 결정대로 구현하고 CD 는 다음 리비전에 반영.
- 조직명 표시(B안)도 채택 안 함 — 날짜/만료만.

### D3. 푸터 CTA — **✅ C안: 브랜딩만, CTA 제거**
푸터에서 "Create your own →" 링크 **제거**. 좌측 브랜딩("Made with **Research**")만 유지.
- **계약 델타**: 푸터 우측 CTA 셀 삭제. per-share 숨김 옵션도 불요(항상 없음).
- **CD 후속**: 푸터 우측 셀 제거 (share-shell-BUILD-SPEC §1 Footer 표의 CTA 행 무효).

## 기술 계약 확정 (writer 결정, 백엔드 스펙 반영 완료 — `pr-artifacts-deliverable-registry-list`)

| # | CD contract-change | 결정 |
|---|---|---|
| 1 | `meta` 표시 계약 | **(a)안**: 서버가 `meta_display: string[]` 반환. adapter.toRow 소유. 클라 per-kind 포맷터 금지. |
| 2 | processing 진행률 | `progress: number \| null` (0~1) 추가. 소스 없는 기능은 null → UI 는 % 없이. |
| 3 | 필터 레일 카운트 | API 가 `facets: {by_feature, by_status}` 반환 (전체 스코프 기준, 서버 계산). |
| 4 | `folder_id` 미사용 | **필드 유지, UI 는 프로젝트 그룹핑만** (폴더 2단계 레일은 후속 판단). |
| 5 | tone→eyebrow 라벨 맵 | 레지스트리 adapter 의 `label` 필드 → 셸에 prop 주입 (셸 feature-blind 유지). |
| 6 | `downloadable` vs `export_formats` | 공유 셸도 `export_formats: string[]` 로 통일 (boolean 폐기). 단일 Download 버튼 = formats[0], 복수면 드롭다운 — 배선 스펙에서 확정. |

## 토큰 2.0 처리 방침
- **독립 PR 로 격리**: `pr-tokens-v2-reconcile` (globals.css 를 tokens.json 2.0 에 reconcile). 산출물 표면 PR 에 섞지 않는다.
- 게이트: Vercel 프리뷰에서 **6위젯 눈검증** (peach 16파일 · sun 10파일 · memphis 그림자 59파일 미세 변화 확인).
- 산출물 표면 배선 PR 들은 **토큰 PR 머지를 base 전제**로 함 (2.0 토큰 없이 빌드하면 drift — TOKEN-DECISIONS §D).
