# 가격 스킴 SSOT (Pricing Scheme)

> **이 문서가 가격 개편 전체의 단일 참조(SSOT) 입니다.**
> 리프라이싱 · 구독 · 무료 grant · 통역 메터링 — 각 코드 PR 은 이 문서를 근거로 구현합니다.
> **숫자/정책이 바뀌면 코드보다 먼저 이 문서를 고칩니다.** 코드( `src/lib/features.ts` 등 )는 이 문서의 값을 반영하는 것이지 그 반대가 아닙니다.

작성: 2026-07-13 · 개정: 2026-07-14 (dual-rail + 70% floor) · 근거: 사용자 세션 — A(접근성) 포지셔닝 + 하이브리드 스킴 + 실측(prod DB 통역량, OpenAI $30/2주) 검증. **2026-07-14 개정**: 통화를 결제 rail 이 결정하는 **dual-rail** 로 전환(LS 카드=USD 볼륨할인 · 계좌이체=KRW flat · 미래 Toss=KRW), 마진 floor 를 **75% → 70%** 로 하향해 리스트에 볼륨할인 headroom 확보, "무할인 균일"(구 §3.3) → **"70% floor 내 볼륨할인"** 으로 개정.

관련: [PROJECT.md §12.2 SSOT 표](../PROJECT.md) (`src/lib/features.ts` = FeatureKey · 크레딧 비용 · 번들 정의) · `docs/DEBT.md`(서버사이드 차감 gate · 결제 연동).

---

## 1. 확정 사항 (2026-07-13, 2026-07-14 dual-rail 개정)

- **포지셔닝 = A (저렴 · 대중 접근).** 기존 "프리미엄 컨설팅급"(₩150k/데스크리포트)에서, **개인 연구자가 부담 없이 만질 수 있는 툴**로 재포지셔닝.
- **dual-rail 통화 (2026-07-14).** 통화는 고객 geo/locale 이 아니라 **결제 rail 이 결정**한다:
  - **LS 카드 rail = USD** — 리스트 **$0.40/cr**, 볼륨할인 적용. 연간·앵커도 이 rail.
  - **계좌이체 rail = KRW** — 리스트 **₩500/cr**(하나은행 flat), 볼륨할인 적용. 유지.
  - **Toss(미래) = KRW** — 지금 스펙 X. KRW SSOT 를 남겨 나중에 붙인다.
- **순마진 70% 하한 = 불변식(invariant).** (2026-07-14, 기존 75% → 70% 하향.) 어떤 결제 경로의 실효 per-credit 도 이 하한 아래로 못 내려가도록 **코드로 강제**(§3). 하향으로 리스트에 볼륨할인 headroom 이 생겼다.
- **볼륨할인 = 양 rail 동일 %** (plus 5 / pro 7.5 / max 10). 리스트가 인상 없이 큰 팩만 할인 — 실효 단가가 70% floor 위에 머문다.
- **스킴 = 하이브리드.** 크레딧(미터링 단위) + 구독(MRR · 편의) + 무료 grant(획득). 크레딧 할인은 **70% floor 내에서만** 허용(구 "무할인" 규칙 폐기, §3.3).

---

## 2. 스킴 개요 (한눈에)

| 축 | 역할 | 값 |
|---|---|---|
| **크레딧** | 모든 위젯 사용의 미터링 단위 | 리스트 ₩500/cr (KRW) · $0.40/cr (USD) |
| **일회성 팩** | 크레딧 선구매 (수량↑ → 볼륨할인) | Mini~Max, 양 rail 동일 % 할인(§5.2) |
| **구독** | MRR · 편의(무만료 · 우선처리 · 시트) | Solo/Plus/Pro, **USD/LS 전용**(§5.3) |
| **무료 grant** | 신규 획득 · 리텐션 | 25cr/월, **월 만료** |

모든 결제 경로(팩 · 구독 · grant)의 **실효 per-credit 이 70% floor(₩396 / $0.283) 위에 머무는 것**이 핵심 — 이래야 70% 불변식이 경로·rail 과 무관하게 성립합니다(§3.3).

---

## 3. 70% 마진 불변식 (핵심 공식)

### 3.1 공식 유도 (2026-07-14, 75% → 70% 하향)

결제수수료 6% 가정. 순마진

```
m = 0.94 − COGS/매출  ≥  0.70
  ⇒ COGS/매출 ≤ 0.24
  ⇒ 매출 ≥ COGS / 0.24
```

₩500/cr 에서 매출 = 500 × cr 이므로:

```
500 × cr ≥ COGS / 0.24
  ⇒ cr ≥ COGS / (500 × 0.24)
  ⇒ cr ≥ COGS / 120
  ⇒ 위젯 최소 크레딧 = ceil( COGS(₩) / 120 )
```

> **한 줄 규칙:** `minCredits[widget] = ceil( COGS(₩) / 120 )`. (75% 시절 divisor 95 → 70% 에서 120.)

**per-credit floor (팩·구독 실효 단가 하한).** 통역 COGS ≈ ₩95/cr(75%@₩500 proxy) 를 binding constraint 로:

```
floor_KRW = ₩95 / 0.24 ≈ ₩396/cr
floor_USD = ₩396 × ($0.40 / ₩500) ≈ $0.283/cr
```

어떤 팩/구독의 실효 per-credit 도 rail 별 floor 이상이어야 한다(양 rail 동일 기준).

### 3.2 코드 강제 (D1 가드)

- 위젯별 `minCredits` + 리스트/floor 상수를 `src/lib/features.ts` 에 박습니다(`MARGIN_FLOOR_KRW_PER_CREDIT` · `MARGIN_FLOOR_USD_PER_CREDIT`).
- CI 가드(`tests/pricing-margin-floor.test.ts`):
  1. **위젯 floor** — 모든 위젯에 대해 `FEATURE_COSTS[k] ≥ MIN_CREDITS[k]`.
  2. **팩 볼륨할인 floor** — 모든 팩의 실효 per-credit 이 양 rail 모두 floor 이상.
  3. **rail 파리티** — KRW·USD 가격이 **동일한 `discountPct` 사다리에서 파생**됨(한쪽만 바뀌면 red).
- 위반 시 머지 차단.

### 3.3 볼륨할인 원칙 (70% floor 내 허용 — 구 "무할인" 폐기)

구 규칙은 "어떤 경로에서도 무할인"(매출/cr = ₩500 고정)이었으나, 마진 하한을 **70% 로 낮춰 headroom 을 확보**하면서 **큰 팩에 볼륨할인을 허용**하도록 개정했습니다.

- **양 rail 동일 % 할인**: plus 5% · pro 7.5% · max 10% (mini/starter 0%). LS(USD)·계좌이체(KRW) 가 같은 `discountPct` 사다리를 씀 — 한쪽만 바꾸면 CI 파리티 assert 가 red.
- **할인해도 floor 위**: 최대 할인(max 10%)에서도 KRW ₩450/cr · USD $0.36/cr 로 floor(₩396 / $0.283) 위. 실효 마진 ≈ 73–75% 유지.
- **KRW 반올림**: KRW 총액은 ₩1,000 단위 반올림(예: plus 300×₩475=₩142,500 → ₩143,000). 반올림 후에도 실효 ≥ floor.
- 구독은 여전히 리스트가($0.40/cr) — 할인 레버는 **연간**(별 스펙)이 담당하고, 월 구독의 가치는 편의(무만료 · 우선처리 · 시트)입니다.

---

## 4. 위젯별 min-cr 표 (추정 COGS 기반 — 실측 시 갱신)

| 위젯 | 추정 COGS(₩) | min-cr(=⌈COGS/120⌉) | 현행 cr | 판정 |
|---|--:|--:|--:|---|
| 데스크 | 5,000 | 42 | 75 | ✅ 여유 |
| 리포트 | 1,500 | 13 | 50 | ✅ 여유 |
| 프로빙/시간 | 1,000 | 9 | 25 | ✅ 여유 |
| 전사록 | 500 | 5 | 25 | ✅ 여유 |
| 인터뷰 | ~1,000 | 9 | 10 | ✅ 여유 — 70% 하향으로 구 경계(⌈1000/95⌉=11) 해소 |
| **동시통역/시간** | 실측 $6–13/hr (₩8.4k–18k) | 70–150 | 125 | ⚠️ 경계선 — E1 가드레일로 자동 보장(§6) |

> 위 COGS 는 대부분 **추정치**입니다. 실측이 들어오면 이 표와 `features.ts` 의 `minCredits` 를 함께 갱신하세요. min-cr 이 현행 cr 을 넘어서는 위젯(현재는 없음, 통역만 경계)은 즉시 가격 상향 대상입니다.

### 4.1 통역 실측 근거 (2026-07-13)

- 통역 prod 사용량: **~7 오디오-시간 / 6주**(저볼륨).
- OpenAI 전체 비용: **$30 / 2주** — 전액을 통역에 귀속한다고 극단 가정해도 **$13/hr 상한**.
- → 통역 순마진 ≈ **72–81%**, 정확히 **75% 경계선**.
- → 이 경계선을 사람 판단에 맡기지 않고 **E1(실 오디오-분 과금 + cr floor)** 로 못박습니다(§6).

---

## 5. 스킴 구조 (기본값 — 후속 PR 에서 조정 가능)

> 아래 팩/구독/grant 수치는 **기본값 제안**입니다. B1(구독 백엔드) 등 후속 PR 에서 최종 확정합니다. 확정 시 이 표를 SSOT 로 갱신.

### 5.1 크레딧 리스트 = ₩500/cr (KRW) · $0.40/cr (USD), 볼륨할인 within 70% floor

### 5.2 일회성 팩 (양 rail 동일 % 볼륨할인)

| 팩 | 크레딧 | USD (LS 카드) | KRW (계좌이체) | 할인 |
|---|--:|--:|--:|--:|
| Mini | 50 | $20 ($0.40) | ₩25,000 (₩500) | — |
| Starter(진입) | 100 | $40 ($0.40) | ₩50,000 (₩500) | — |
| Plus | 300 | $114 ($0.38) | ₩143,000 (₩477) | 5% |
| Pro | 600 | $222 ($0.37) | ₩278,000 (₩463) | 7.5% |
| Max | 1,500 | $540 ($0.36) | ₩675,000 (₩450) | 10% |

- **discountPct 사다리(양 rail 공통)**: 0 / 0 / 5 / 7.5 / 10. `features.ts` 의 팩별 `discountPct` 가 SSOT — priceUsd·priceKrw 는 여기서 파생.
- USD = 크레딧 × $0.40 × (1−할인). KRW = 크레딧 × ₩500 × (1−할인) → ₩1,000 반올림.
- 최대 할인에서도 USD $0.36/cr · KRW ₩450/cr 로 floor($0.283 / ₩396) 위(§3.3).

### 5.3 구독 (월 · LS 카드 USD 전용 · 계좌이체 미제공)

| 티어 | 월 요금($) | 포함 cr/월 | 참고 KRW |
|---|--:|--:|--:|
| Solo | 8 | 20 | ₩10,000 |
| Plus | 24 | 60 | ₩30,000 |
| Pro | 64 | 160 | ₩80,000 |

- 구독 결제 통화 = **USD(LS 카드)**. 월 리스트가는 $0.40/cr 무할인 — 할인 레버는 **연간**(아래 §5.3.1).
- `monthlyPriceKrw`(참고 KRW)는 미래 Toss(KRW) rail 을 위한 legacy SSOT 로 남겨 둔다 — 현재 구독 결제엔 미사용.

#### 5.3.1 연간 구독 (USD · 1개월 무료) — 2026-07-14

| 티어 | 연간($) | 연 포함 cr | 연 effective $/cr | 절약 |
|---|--:|--:|--:|--:|
| Solo | 88 | 240 | 0.367 | 1개월 |
| Plus | 264 | 720 | 0.367 | 1개월 |
| Pro | 704 | 1,920 | 0.367 | 1개월 |

- **연간 = 1개월 무료** — `annualPriceUsd = monthlyPriceUsd × 11`, `annualIncludedCredits = includedCredits × 12`. 실효 8.3% off.
- 연 effective **$0.367/cr > USD floor $0.283** → 마진 안전. 무료 개월을 2로 늘리면(16.7%) floor 근접·붕괴 위험이라 **1개월 고정**(SSOT `ANNUAL_FREE_MONTHS = 1`, floor 테스트가 강제).
- 연간은 **USD 전용**(계좌이체/KRW 미제공). env 키 `LEMONSQUEEZY_SUB_{SOLO,PLUS,PRO}_ANNUAL_USD` · SKU `rc-sub-{tier}-annual` (LS 대시보드 1회 생성 — Chris).
- 지급 = **결제 시 연 포함크레딧 1회 일괄**(무만료 버킷). 멱등은 월간과 동일 `subscription_grants(ls_subscription_id, period)` 유니크(period=renews_at 날짜). checkout `interval: 'month'|'year'` 파라미터로 variant 선택, `organizations.subscription_interval` 에 주기 persist(갱신 시 오지급 방지).
- **이연부채 인지**: 연 일괄 대량 크레딧 무만료 = 미소진 크레딧이 이연부채로 잡힌다(회계 관점).

- 구독의 **가치 = 할인이 아니라 편의**: 크레딧 무만료(구독 중) · 우선 처리 · 시트(팀).
- **오버리지** = 언제든 ₩500/cr 일회성 top-up.
- 구독 크레딧의 **만료/롤오버 정책 = 무만료 (B1 확정, 2026-07-13).** 매 결제주기마다
  포함 크레딧을 비만료 `organizations.credit_balance` 에 적립한다(무료 grant 의 월-만료
  `grant_credits` 버킷과 분리). 취소·만료 시에도 이미 지급된 크레딧은 회수하지 않고
  구독 상태(`subscription_status`)만 해제한다. 근거: 위 "크레딧 무만료(구독 중)" 가치
  선언과 정합, 기존 `grant_credits_from_payment`(=credit_balance 적립) 패턴 재사용으로
  가장 단순. 멱등 지급은 `subscription_grants(ls_subscription_id, period)` 유니크로 강제
  (billing period 당 1회). 구현: `grant_subscription_credits` RPC + webhook
  `subscription_created`/`subscription_payment_success` 핸들러.

### 5.4 무료 grant

- **25cr/월 지급, 월 만료.** 신규 획득 · 리텐션용.
- COGS 거의 0(대부분 저비용 위젯에 소진되는 소액 grant).
- 이월 없음(월 만료) — 남은 crédit 이 무한 누적되지 않게.

---

## 6. 통역 가드레일 (E1)

통역은 §4.1 실측상 75% 경계선이라 **두 겹의 가드**로 마진을 자동 보장합니다.

1. **실 오디오-분 과금** (wall-clock 아님).
   - `translate_recordings.duration_sec` 기반으로 **실제 오디오 길이**만 과금.
   - 좀비 세션 · 침묵 구간으로 새는 매출·원가를 정렬(원가는 실 오디오에 비례, 과금도 실 오디오에 비례).

2. **분당 cr floor** = `ceil(COGS_실측 / 95)`.
   - 실측 ≤ $8.5/hr 이면 현행(125cr/hr 수준) 유지.
   - 실측이 초과하면 floor 로 **자동 상향**(상한 ~180cr/hr = $13/hr 대응).
   - §3.2 의 D1 가드가 통역에도 동일하게 적용됩니다.
   - **2026-07-14 노트**: 팩/위젯 floor divisor 는 70% 로 95→120 이 됐지만, **통역 E1 분당 floor 는 divisor 95(75% 기준)를 의도적으로 유지**한다 — 통역은 변동비 대부분이 realtime 원가라 실측 COGS 확정 전엔 **더 높은(보수적) floor** 가 마진 보호에 유리하기 때문. 실측이 들어오면 `TRANSLATE_METERING.floorCogsKrwPerMinute` 와 함께 재검토.

---

## 7. 롤아웃 (PR 매핑)

| Phase | 목표 | PR |
|---|---|---|
| **1 — 가격 인하** | ₩500/cr 전환 | **이 문서(SSOT)** → A1(`features.ts` 리프라이스) → A2(랜딩/크레딧 UI) → D1(floor 가드) · + Chris LS 팩 리프라이스 |
| **2 — MRR** | 구독 · 무료 grant | B1(구독 백엔드) → B2(구독 UI) · C1(무료 grant) · + Chris LS 구독상품 |
| **3 — 가드레일** | 통역 메터링 | E1(통역 실 오디오-분 과금 + cr floor) |

- **이 문서가 Phase 1 의 첫 항목** — 나머지 코드 PR 은 전부 이 문서를 근거로 진행하므로 **먼저 머지**합니다.
- 각 PR 이 이 문서의 어떤 수치를 구현/변경하는지 PR 본문에 §번호로 링크하세요.

---

## 8. 변경 이력

- **2026-07-13** — 최초 작성. 가격 개편 착수: ₩500/cr(4배 인하) + 순마진 75% 불변식(`min-cr = ⌈COGS/95⌉`, D1 CI 가드) + 하이브리드 스킴(크레딧 무할인 · 구독 · 무료 grant) + 통역 E1 가드레일. 실측(통역 ~7h/6주, OpenAI $30/2주)으로 통역 75% 경계 검증. 이 문서가 가격 개편 전체 SSOT.
- **2026-07-14** — **dual-rail + 70% floor 개정.** 통화를 결제 rail 이 결정하도록 전환: LS 카드=USD(리스트 $0.40/cr) · 계좌이체=KRW(리스트 ₩500/cr, 하나은행 flat) · 미래 Toss=KRW(설계 여지만). 마진 floor 75% → **70%** 하향(위젯 divisor 95→120, per-credit floor ₩396/$0.283) 하여 headroom 확보. 구 §3.3 "무할인 균일" → **"70% floor 내 볼륨할인"**(양 rail 동일 %: plus5/pro7.5/max10). 팩/구독에 USD SSOT(`priceUsd`/`monthlyPriceUsd`) 추가, `discountPct` 사다리를 rail 파리티 SSOT 로. CI 테스트를 equality → floor+parity 로 전환. checkout LS rail = USD 고정, 계좌이체 = KRW 유지, payments 에 `amount_usd` additive 컬럼. 통역 E1 분당 floor 는 divisor 95(보수적) 유지.
