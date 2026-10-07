# WIDGET CHAIN — BUILD-SPEC

> **CD SSOT:** `widget-chain.dc.html`. **인풋:** `CONTEXT-FOR-CD.md`(widget-chain, 2026-10-07). **셸:** `WIDGET-SHELL.md` — 바뀌지 않음.
> 인라인 hex/px 는 렌더용. diff 대상은 이 문서의 토큰/클래스 칸.

## §0 CD 결정 (브리프 §6 열린 질문)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| Q1 | 승인 모먼트 위치·강도 | **캔버스 상단 체인 바의 아래 행**(인라인, 비차단) | 체인 위젯이 캔버스에서 비인접(프로빙과 전사 사이에 통역). 카드에 띄우면 화면 밖에서 놓침. 모달은 다른 위젯 작업을 끊음. 리크루팅 브리지 바(N1)와 같은 문법 |
| Q2 | "연결됨" 시각 언어 | **바의 단계 트랙 + 카드 서브바 우측 칩** | 카드 간 커넥터 선은 비인접 카드에서 성립 안 함. 셸(헤더·툴바) 무수정 |
| Q3 | 자동 모드 차등 | **타일·모드 배지 ink 채움 + 승인 행 없음.** 트랙은 동일 | 다른 것은 "사용자를 부르느냐"뿐. 크레딧 부족 시 자동도 같은 amber 행으로 멈춤 |
| — | 프로젝트 선택(§2-5) | **승인 행 안에 피커로 합침**(B3). 별도 스텝·모달 없음 | 1회성 결정이 승인과 같은 순간에 필요 |
| — | Navigator | **파일럿에서 변경 없음** | 캔버스에 바가 있으면 충분. 후속 검토 |

## §1 클래스맵

### 1.1 체인 바 `<ChainBar view={ChainView} />`
| 요소 | 값 | 토큰 / 클래스 |
|---|---|---|
| 위치 | 캔버스 뷰포트 **sticky top 16** · 가로 중앙 · z 50(Picker 포털 z-60 아래) | `sticky top-4 mx-auto z-50` |
| 프레임 | **폭 1040** · border **2** ink · radius **panel 12** · `shadow-popover` 4px4px0 ink/20 · paper | `border-2 border-ink rounded-panel shadow-popover` |
| 상단 행 | pad 11/16 · gap 14 · 좌 타일 → "체인"+모드 배지 → 구분선 1.5×30 ink/12 → 트랙(flex) → 상태 텍스트 | — |
| 체인 타일 | 34×34 · border 1.5 ink · radius **icon 9** · link 아이콘 17 · approve=paper/ink 스트로크 · **auto=ink 채움/흰 스트로크** | `rounded-icon` |
| 모드 배지 | pill · border 1.5 ink · 10/800 · pad 0/7 · approve=paper · **auto=ink/흰 글자** | `rounded-pill` |
| 상태 텍스트 | mono 11/800 · 색 = 상태별(§3) | `font-mono` |
| 아래 행(조건부) | border-t **1.5** · pad 11/16 · gap 12 · 메시지(13·1.55) → [피커] → [체인 종료] → [보조] → [주] | 행 색 §3 |

### 1.2 트랙 노드 (steps[] 1:1)
| 요소 | 값 |
|---|---|
| 노드 | 28 원 · 칸 폭 118 · 라벨 11.5 · 비용 mono 9.5 `mute-soft` |
| 채움 | **그 단계를 맡은 위젯 톤** — probing sky · transcripts lav · interview_ingest/topline rose |
| 연결선 | 앞 노드 done/skipped → **2px ink 실선**, 그 외 → 2px `line-empty` 점선 · 노드 중심 높이(14) |
| 상태별 | §1.3 |

### 1.3 노드 상태 6종
| status | 테두리 | 채움 | 글리프 | 라벨 | 모션 |
|---|---|---|---|---|---|
| done | 2 ink | 톤 | ✓ | ink 700 | — |
| running | 2 ink + 링 `0 0 0 3px paper, 0 0 0 5px processing` | 톤 | • | `processing.text` 800 | **링 펄스(running 만)** |
| awaiting | **2 dashed amber** | `amber.bg` | ? | `amber.text` 800 | — |
| pending | 1.5 dashed `line-empty` | paper | — | `mute-soft` | — |
| skipped | 1.5 ink/24 | `disabled` | – | `mute-soft` **취소선** | — |
| error | 2 `error` | `error.bg` | ! | `error.text` 800 | — |
| (paused — 표시 전용) | **2 solid amber** | paper | Ⅱ | `amber.text` 800 | — |

> `paused` 는 steps 계약에 없는 **표시 상태**입니다: `status==='paused_insufficient_credits'` 일 때 `steps[currentStep]` 을 이 형태로 렌더. 대기(점선)와 멈춤(실선)을 테두리 선종으로 가릅니다.

### 1.4 카드 체인 칩
| 요소 | 값 | 비고 |
|---|---|---|
| 위치 | 카드 **서브바 우측**(margin-left auto) | `WidgetShell` 서브바 슬롯 — 헤더·툴바 무수정 |
| 형태 | pill · border 1.5 · pad 2/9/2/7 · 10.5/800 · link 아이콘 12 · 라벨 `체인 {n}/{총} · {상태}` | 상태 색 §3 칩 열 |
| 비체인 카드 | 칩 없음 | |

### 1.5 진입점 (프로빙 셋업 카드 본문, 접힌 아코디언 아래)
| 요소 | 값 |
|---|---|
| 블록 | off: border 1.5 ink/16 · 그림자 없음 / on: border **2** ink · `shadow-memphis-md-faint` · radius 12 |
| 헤더 행 | 타일 34 + 제목 14/800 + 부제 12 mute + **토글 42×24**(off=disabled 트랙 · on=ink 트랙 + rose 노브) |
| 모드 세그먼트 | SSOT §D3 세그먼트 — border 1.5 · radius **control 10** · 선택=ink |
| 미리보기 | 4행 · 번호 mono · 톤 도트 12 · 이름 · 노트 · 비용 mono 64 우측 · 1행(프로빙) bg `canvas` = 이미 결정된 단계 |
| 합계 행 | `paper-soft` · "세션 후 이어질 비용" · **💎1 + 파일당 25** (전사 1 + 인제스트 파일당 25 + 탑라인 포함) |
| 자동 경고 | amber 틴트 박스 · "단계마다 묻지 않고…" |
| 푸터 | footNote 에 `· 이어서 3단계` / `· 자동 3단계` 덧붙임. CTA 라벨 불변 |

## §2 proposed-token / proposed-icon
- 신규 토큰 **없음.** 전부 tokens 2.0 + SSOT §B (`shadow-popover` 는 06/07 번들과 같은 승격 건).
- **proposed-icon:** `link` — 이미 공유 버튼에서 쓰는 체인 링크 글리프. 세트 등재 확인만.

## §3 상태 매트릭스 (최소 8 → 9 + 진입점 3 + 칩 6)

| # | ChainView.status | 아래 행 | 행 색 | 상태 텍스트 | 주 / 보조 | 칩(현재 카드) |
|---|---|---|---|---|---|---|
| B1 | running · approve | 없음 | — | `n/4 · {단계} 중` processing | — | 진행 중 |
| B2 | awaiting_approval | 있음 | amber | `n/4 완료` amber | **진행 · 💎{cost} →** / 건너뛰기 · 체인 종료(텍스트) | 다음 카드: 승인 대기 |
| B3 | awaiting_approval + `projectId===null` + 다음=interview_ingest | 있음 + **피커** | amber | 동일 | 진행 **잠김**(선택 전) · 건너뛰기 **숨김** · 체인 종료 | 동일 |
| B4 | running · auto | 없음 | — | processing | — | 진행 중 |
| B5 | paused_insufficient_credits | 있음 | amber | **멈춤** amber | **💎 충전하기** / 재개 · 체인 종료 | 멈춤 |
| B6 | error | 있음 | error | **체인 종료됨** error | **{위젯} 열기** / 닫기 | 멈춤 |
| B7 | running (skipped 포함) | 없음 | — | processing | — | 건너뜀(해당 카드) |
| B8 | done | 있음 | success | `4/4 완료` success | **보고서 열기 ⤢** / 닫기 | 완료 |
| B9 | cancelled | 있음 | neutral | 체인 종료됨 mute | — / 닫기 | — |
| E1–E3 | 진입점 off / approve / auto | — | — | — | CTA "세션 시작" 불변 | — |

**유령 상태 금지:** B5·B6·B9 에서 processing 색 · 링 · 펄스가 **하나도** 보이면 안 됩니다. 상태 텍스트는 "진행"이라는 말을 쓰지 않습니다.

**비용 표시:** `cost===0` → `포함`(금액 미표시). 진행 버튼 = `진행 · 💎{steps[currentStep+1].cost} →`. 다음 단계가 0 이면 `진행 →`.

## §4 인터랙션
- 액션 `approve(i)` · `skip(i)` · `cancel()` · `resume()` 전부 컨테이너 소유. 프레젠테이션은 콜백만 받음.
- **체인 종료**는 확인 모달 **없음** — 데이터 손실이 없고 결과는 각 위젯에 남음(B9 문구가 그걸 말함).
- 완료(B8)·실패(B6)·종료(B9) 바는 **자동으로 사라지지 않음.** "닫기"로만 제거.
- 바 접기/펼치기는 **없음**(파일럿). 아래 행이 없는 상태가 이미 한 줄.
- `prefers-reduced-motion`: running 링 펄스 제거, 정적 링 유지.

## §5 contract 질의 (writer)
1. `⚠️ proposed-prop: steps[].fileCount?` — 인제스트 "💎75 (파일 3 × 25)" 분해 표시용. 없으면 `cost` 합계만.
2. `⚠️ proposed-prop: creditBalance?` — B5 "잔액 💎12" 표시용. 없으면 해당 구절 삭제(레이아웃 성립).
3. `⚠️ 확인: error 시 크레딧 환불 여부` — B6 "크레딧은 차감되지 않았습니다" 문장의 근거. 정책이 다르면 문장 삭제.
4. `⚠️ 확인: cancelled 시 남은 steps status` — pending 으로 남으면 표시만 skipped 로 매핑(B9).
5. `⚠️ 확인: 프로젝트 피커 데이터` — 기존 프로젝트 목록 소스. 컨테이너 소유로 가정.

## §6 안 그린 것
- 4로케일 카피(i18n 키는 writer 통합 스펙). 한국어만 그렸고, 메시지는 **한 문장 + 강조 구 1개** 구조라 키 3분할(`msgA/msgB/msgC`)로 옮기면 됩니다.
- 전사록·인터뷰 분석 진입점(E 변형). 진입 위젯만 다르고 블록은 동일, 미리보기 행 수만 3/2.
- 크레딧 충전 화면 자체(제품 전역 미설계 — 별도).
- 모바일 · Navigator.
