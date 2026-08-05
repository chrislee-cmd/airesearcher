# GEOMETRY — 인터뷰 결과 생성기 리디자인

> `interview-results.dc.html` 에서 실측. 2026-08-05.
> **container-owned** = 앱이 최종 W/H 를 정하는 프로토 값. **FIXED** = 늘어나면 구성이 깨지는 값.
> 셸 프레임 값은 `FULLVIEW-SHELL.md §F1` · `WIDGET-SHELL.md §S1a` 와 같습니다. 여기서는 **인터뷰 고유 치수와 그 산술 근거**만 적습니다.

---

## §A 위젯 카드

| 항목 | 값 | 성격 |
|---|---|---|
| 카드 | 604 × 900 · border 3 · radius 20 · shadow 4px4px0 ink | container-owned (`WIDGET-SHELL.md §S1a`) |
| 헤더밴드 | pad 18 / 22 · 제목 29/800/-0.9 | FIXED |
| 툴바 pill | 셀 44 × 4 + 구분선 1.5 × 3 = **180.5** · radius 10 | FIXED (`toolbar-guide-SPEC.md §1–2`) |
| 컨트롤바 (active) | height 48 (pad 12 상하 + 내용 24) · `border-b 1.5` | FIXED |
| 본문 | pad 18 / 22 (idle 은 22 / 22) · `flex:1; overflow-y:auto` | — |
| Ambient progress 밴드 | pad 13 / 22 · 진행바 h 8 · 내부 gap 9 → 총 height **≈ 96** | FIXED · `flex-shrink:0` |
| 푸터 | pad 15 / 22 · `border-t 1px ink/8` | FIXED |
| 본문 가용 높이 (generating) | 900 − 3·2(border) − 74(헤더) − 48(컨트롤바) − 96(밴드) − 58(푸터) = **≈ 618** | 계산값 |

### §A1 인덱싱 4단 타임라인
| 항목 | 값 |
|---|---|
| 노드 | 20 (카드 안) / 22 (안내용) · 원형 |
| 연결선 | height 2 · flex 0 0 20~26 |
| 라벨 | 10 / 700 · 노드 아래 gap 5 |
| 4단 전체 | 폭은 컨테이너 100%, 각 단은 `flex:1` |

### §A2 파일 행
| 상태 | height | 비고 |
|---|---|---|
| ready / 대기 / 실패 | **≈ 62** (pad 11 상하 + 2줄 텍스트) | radius 11 |
| 처리중(타임라인 포함) | **≈ 118** (행 62 + gap 8 + 타임라인 48) | radius 11 |
| 카드 요약 그리드(1d) | 2열 · gap 8 · 셀 height ≈ 52 | radius 11 |

---

## §B 풀뷰 셸

| 항목 | 값 | 성격 |
|---|---|---|
| 프레임 | 1400 × 840 · border 3 · radius 14 · shadow 8px8px0 ink/28 | container-owned |
| 사이드바 | **240** | FIXED |
| 헤더밴드 | pad 13 / 24 · height **≈ 60** | FIXED |
| **탭바 (신규 행)** | pad 9 / 20~24 · height **≈ 47** · `border-b 2px ink` | FIXED |
| 본문 영역 높이 | 840 − 3·2 − 60 − 47 = **≈ 727** | 계산값 |
| 본문 영역 폭 | 1400 − 3·2 − 240 = **≈ 1154** | 계산값 |

### §B1 3열 구성 (status 별)
| status | 좌 | 중앙 | 우 | 중앙 실폭 |
|---|---|---|---|---|
| none / loading / generating | 파일 패널 **300** | 본문 | — | 1154 − 300 = **854** |
| **done** | 파일 레일 **56** | 본문 | 목차 **220** | 1154 − 56 − 220 = **878** |
> 파일 패널을 done 에서 접는 이유: 300 + 220 을 동시에 쓰면 본문이 634 로 줄고, 표의 5열(구분/전체/A/B/차이)과 13.5px 본문이 같은 폭 안에서 성립하지 않습니다. 878 은 거터 52 + gap 14 + 본문 **최대 830** 을 담습니다.

### §B2 사이드바 7항목 수용 검증
| 요소 | 값 |
|---|---|
| 패딩 | 14 상하 / 12 좌우 |
| 섹션 라벨 | 4/8/8 pad → height ≈ 26 |
| 항목 | pad 10 / 12 · 폰트 13.5 → height **≈ 42** · gap 6 |
| 7항목 | 42×7 + 6×6 = **330** |
| 푸트노트 카드 | pad 10 / 12 · 2줄 → **≈ 56** |
| 합계 | 14 + 26 + 6 + 330 + 56 + 14 = **446** / 840 → 여유 394 |
> 8항목까지도 488 로 들어갑니다. 9항목부터 스크롤이 필요하고, 그때 `FULLVIEW-SHELL.md §F2` 개정이 필요합니다.

### §B3 파일 패널
| 항목 | 값 |
|---|---|
| 펼침 폭 | **300** FIXED · pad 16 · gap 10~11 |
| 접힘 폭 | **56** FIXED · ▶ 버튼 30 × 30 radius 9 · 세로 mono 라벨 |
| 행 (펼침) | height ≈ 46 · radius 11 |
| 행 (순회중, 2c) | height ≈ 46 · 좌측 상태 원 20 |

### §B4 목차 rail
| 항목 | 값 |
|---|---|
| 폭 | **220** FIXED · pad 16 / 14 |
| 항목 | pad 6 상하 / 11 좌 · `border-l 3px` · 12px |
| 하단 메타 카드 | radius 10 · pad 11 / 12 · `margin-top:auto` |

---

## §C 보고서 본문

### §C1 읽기 컬럼
| 항목 | 값 | 근거 |
|---|---|---|
| 캔버스 pad | 34 상 / 24 좌우 / 46 하 | — |
| 컬럼 max-width | **830** · `margin:0 auto` | 878 − 24·2 = 830 |
| 거터 | **52** · `text-align:right` · gap 14 | 컴프 주석 전용 — **구현 시 0** |
| 실제 본문 폭 (컴프) | 830 − 52 − 14 = **764** | 13.5px 본문에서 한 줄 40~45자 |
| 실제 본문 폭 (구현) | **830** | 거터가 빠지므로 컬럼 폭을 **764 로 고정**해 측정치를 유지할 것 |
> ⚠️ 거터를 없애면서 본문을 830 으로 늘리지 마세요. 줄당 글자수가 늘어 읽기 리듬이 깨집니다. 본문 컬럼은 **764 고정, 가운데 정렬**입니다.

### §C2 블록 수직 리듬
| 관계 | 값 |
|---|---|
| `heading` 앞 | **44** |
| `heading` → 첫 자식 | 16~18 |
| 본문 블록 사이 | **20** |
| `insight` 연속 | 14 |
| `subheading` → `paragraph` | 12 |
| `executive_summary` → 첫 `heading` | 44 |

### §C3 표
| 항목 | 값 |
|---|---|
| 캡션 eyebrow | mono 10 · 대문자 · margin-b 8 |
| wrapper | border 2 · radius 12 · shadow 3px3px0 ink/14 |
| th | pad 10 / 14 · mono 10 · `border-b 2px ink` |
| td | pad 9 / 14 (실행 우선순위 표는 11 / 14) · 12.5 · `border-b 1px line` |
| 차이 열 | 헤더·셀 `bg rose-bg` · 우정렬 |
| 각주 | mono 10.5 · `faint` · margin-t 8 |
| 해석 주의 노트 | border 1.5 `amber-line` · radius 10 · `warning-bg` · pad 10 / 13 · margin-t 10 |

### §C4 차트
| 항목 | 값 |
|---|---|
| 프레임 | border 2 · radius 12 · shadow 3px3px0 ink/14 |
| 헤드 | pad 12 / 18 · `paper-soft` · eyebrow + 14/800 |
| 플롯 pad | 18 |
| 막대 행 | height **22** · gap 12 · 라벨 열 **120** 우정렬 · 값 열 **34** 우정렬 |
| 트랙 | radius 4 · border 1px line · `paper-soft` |
| 도넛 | viewBox 42 · r **15.915**(둘레 100) · stroke-width **9** · `rotate(-90deg)` · 렌더 150 × 150 |
| 범례 | gap 11 · 스와치 12 radius 3 border 1.4 ink |
| 푸터 각주 | pad 10 / 18 · `surface-canvas` · mono 10.5 |
> `h-60` 고정은 폐기했습니다. 높이는 = pad 18·2 + 행수 × 22 + (행수−1) × 12.

### §C5 인용 · 삽입 블록
| 항목 | 값 |
|---|---|
| quote | `border-l 3` · radius 0 12 12 0 · pad 16 / 20 · gap 14 · 글리프 34/800 line-height 0.9 |
| quote 본문 | **14.5 / 1.8** (본문 13.5 보다 1pt 큼 — 목소리를 본문보다 앞세움) |
| attribution | mono 10.5 · margin-t 10 |
| inserted_* 헤더 | pad 9 / 16 · dashed `border-b 1.5` |
| inserted_* 본문 | pad 15 / 18 · gap 10~12 |
| citation 칩 | 폰트 9.5 · pad 0 / 4 · radius 4 · margin-l 3 (연속 시 2) · `translateY(-3px)` |
| citation 팝오버 | max-w **420** · 헤더 pad 8 / 13 · 본문 pad 13 · 푸터 pad 9 / 13 |

---

## §D 모달 · 배너 · skeleton

### §D1 모달
| 모달 | 폭 | 프레임 |
|---|---|---|
| 재생성 | **560** container-owned | border 3 · radius 18 · shadow 8px8px0 ink/40 · 헤더 pad 14/20 · 본문 pad 20 · 푸터 pad 14/20 |
| — 방향 textarea | min-height **100** · pad 13 / 15 · radius 12 · border 1.5 ink | 600자 상한 카운터는 우측 정렬 mono 10.5 |
| — 언어 pill | pad 7 / 14 · radius 999 · gap 7 · 줄바꿈 허용 | 6개가 560 안에서 2줄 |
| 공유 초대 | **560** container-owned | border 3 · radius 18 · shadow 6px6px0 ink/30 |
| — 링크 필드 | radius 10 · pad 10 / 13 · mono 11.5 | 복사 버튼 radius 10 · pad 10 / 16 |
| 빈 상태 인트로 카드 (2a) | max-w **620** · border 3 · radius 16 · shadow 6px6px0 ink/16 | 헤더 pad 20 / 26 · 본문 pad 22 / 26 |

### §D2 배너
| 항목 | 값 |
|---|---|
| 프레임 | border 2 · radius 12 · pad 15 / 18 · gap 13 |
| 아이콘 | 17px · `flex-shrink:0` |
| 제목 → 본문 | margin-b 4 |
| 오류 코드 박스 | mono 10.5 · pad 6 / 10 · radius 6 · margin-t 9 |
| 위치 | 본문 컬럼 최상단, `executive_summary` **위**. 배너 → exec 간격 20 |

### §D3 skeleton (2b · 2c)
| 요소 | height | radius |
|---|---|---|
| 본문 줄 | **11** | 4 |
| 제목 줄 | 17~20 | 5 |
| eyebrow 줄 | 9~12 | 4 |
| 아티팩트 블록 | 130~150 | 12 |
| 파일 행 | 46 | 11 |
| 줄 간격 | 12 (그룹 내) / 26 (그룹 간) | — |
| 색 | `rgba(29,27,32,.04 ~ .10)` — 값이 클수록 위계가 높은 요소 | — |
> generating(2c)의 skeleton 은 `opacity:.55` 로 한 단계 더 눕힙니다. 진행 카드가 주인공이기 때문입니다.

---

## §E SectionGap · 드래그

| 항목 | 값 |
|---|---|
| Gap 높이 | **26 고정** (유휴·hover·열림 전환 시 레이아웃이 밀리지 않아야 함) |
| 유휴 노드 | 20 × 20 · radius 7 · border 1.4 `line-strong` |
| hover 라벨 | pad 4 / 11 · radius 8 · shadow 2px2px0 ink |
| 열림 카드 | border 2 · radius 12 · shadow 3px3px0 ink/14 · 내부 pad 12 / 14 |
| pending 카드 | 2px dashed · radius 12 · pad 14 / 16 |
| 선택 하이라이트 | pad 1 / 2 · `border-b 2px` |
| 부유 "질문하기" 버튼 | pad 7 / 14 · radius 999 · shadow 2px2px0 ink/30 · 선택 영역 아래 9px |

---

## §F 목록 · 검색

| 항목 | 값 |
|---|---|
| 프로젝트 카드 그리드 | 2열 · gap 14 · pad 20 / 22 · `align-content:start` |
| 프로젝트 카드 | border 2 · radius 12 · 헤더 스트립 pad 11 / 15 · 본문 pad 13 / 15 |
| 목록 툴바 | pad 14 / 22 · 검색 필드 max-w 280 radius 999 |
| 채팅 말풍선 | 사용자 max-w **70%** · 응답 max-w **82%** · pad 11~14 / 15~16 |
| 채팅 입력행 | pad 14 / 22 · 필드 radius **22** · 버튼 radius 22 pad 11 / 20 |
| 근거 응답자 칩 | mono 10.5 · pad 3 / 9 · radius 6 · gap 7 |
