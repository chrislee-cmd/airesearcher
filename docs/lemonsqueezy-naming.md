# Lemon Squeezy 상품 네이밍 규약 (SSOT) — 브랜드 표시명 + variant SKU 분리

> 이 문서는 Chris 가 Lemon Squeezy **대시보드에서 상품을 생성/수정할 때** 그대로
> 옮겨 적는 확정 규약표입니다. 스크립트(`scripts/provision-lemonsqueezy-products.ts`)는
> 여기 정의된 **SKU 로 상품을 매칭**해 variant id → env 키를 산출합니다.

## 왜 분리하는가 (B안)

기존 규약 `AIR • pack • mini` 는 **표시명 + 기계 매칭키를 한 필드(상품명)에 혼합**했습니다.
그 결과 `AIR •` 가 **호스티드 checkout · 영수증 · 인보이스 · 대시보드 주문내역 · 환불/분쟁 ·
세무 리포트** 전반에 그대로 노출됐습니다. 정식 제품명은 **Research Canvas** 입니다.

- **A안**(checkout `product_options.name` override) = 결제창 한 면만 가리고 나머지 기록은
  `AIR •` 잔존 → 표시-기록 영구 불일치. **기각.**
- **B안 (확정)** = 상품 레코드 이름 자체를 **브랜드 표시명**으로, 기계 매칭은 표시명이 아니라
  **variant SKU** 로 분리. 마케팅상 상품명이 바뀌어도 SKU 정확일치라 매칭이 안 깨집니다.

| 관심사 | LS 필드 | 값 예시 |
|---|---|---|
| 사람/상거래용 이름 (노출) | **Product Name** | `Research Canvas — 크레딧 팩 Mini (50)` |
| 기계 매칭 키 (안정) | **variant SKU** | `rc-pack-mini` |

## ⚠️ LS 에는 native `sku` 필드가 없다 → SKU 는 **Variant Name** 에 입력

Lemon Squeezy API v1 은 Variant 객체에도 Price 객체에도 **`sku` 속성이 없습니다**
(2026-07 공식 문서 확인:
[Variant Object](https://docs.lemonsqueezy.com/api/variants/the-variant-object) ·
[Price Object](https://docs.lemonsqueezy.com/api/prices/the-price-object)).

따라서 SKU 는 운영자가 제어 가능하고 **Product Name 과 독립**인 필드에 저장해야 하며,
그 자리로 **Variant Name** 을 사용합니다. 단일 variant 상품에서 체크아웃·영수증은
**Product Name** 을 노출하고, **Variant Name** 은 매칭 전용으로만 쓰입니다.

- **대시보드 입력법**: 상품 생성 시 **Product Name = 표시명**, 그 상품의 **variant 이름 =
  아래 SKU 문자열**(`rc-pack-mini` 등)을 그대로 입력.
- 스크립트 매칭 순서: `variant.attributes.sku`(향후 일부 스토어가 노출할 수 있어 방어적으로
  우선 read) → `variant.attributes.name`(= Variant Name) 를 정규화 정확일치.
- 정규화: 소문자 + 비영숫자를 공백으로 → `rc-pack-mini` == `rc pack mini` (하이픈/대소문자 무관).

## 팩/구독 구분자 필수

`plus` · `pro` 는 **팩과 구독 양쪽에 존재**합니다. 이름·SKU 둘 다 `pack`/`sub` 구분자를
포함해 혼동(팩-plus 300cr 일회성 vs 구독-plus 60cr/월)을 방지합니다.

## 확정 규약표 — 크레딧 팩 5종 (KRW / USD 공통 이름·SKU)

가격 SSOT = `src/lib/features.ts` 의 `CREDIT_BUNDLES` (₩500/cr 균일 · 무할인). USD 가격은
SSOT 아님 — 스토어 실값 우선, 스크립트는 FX 로 예상가만 제시.

| id | credits | KRW 가격 (일회성) | Product Name (표시명) | variant SKU |
|---|---|---|---|---|
| mini | 50 | ₩25,000 | `Research Canvas — 크레딧 팩 Mini (50)` | `rc-pack-mini` |
| starter | 100 | ₩50,000 | `Research Canvas — 크레딧 팩 Starter (100)` | `rc-pack-starter` |
| plus | 300 | ₩150,000 | `Research Canvas — 크레딧 팩 Plus (300)` | `rc-pack-plus` |
| pro | 600 | ₩300,000 | `Research Canvas — 크레딧 팩 Pro (600)` | `rc-pack-pro` |
| max | 1,500 | ₩750,000 | `Research Canvas — 크레딧 팩 Max (1,500)` | `rc-pack-max` |

## 확정 규약표 — 월 구독 3종

가격 SSOT = `SUBSCRIPTION_TIERS` (월정액, 포함 크레딧/월). LS variant 는 **subscription /
monthly** 로 설정.

| id | 포함 cr/월 | KRW 가격 (월) | Product Name (표시명) | variant SKU |
|---|---|---|---|---|
| solo | 20 | ₩10,000 | `Research Canvas — 구독 Solo (월 20cr)` | `rc-sub-solo` |
| plus | 60 | ₩30,000 | `Research Canvas — 구독 Plus (월 60cr)` | `rc-sub-plus` |
| pro | 160 | ₩80,000 | `Research Canvas — 구독 Pro (월 160cr)` | `rc-sub-pro` |

## i18n 라벨 정합

표시명의 티어 라벨(Mini/Starter/Plus/Pro/Max)은 앱 i18n 의
`messages.Credits.bundle{Mini,Starter,Plus,Pro,Max}` 와 동일합니다. 표시명 카피를 바꿀 때는
i18n 라벨도 함께 맞춰 SSOT 일관성을 유지하세요.

## 운영 흐름

1. Chris 가 대시보드에서 위 표대로 팩5 + 구독3 을 생성 (Product Name = 표시명,
   Variant Name = SKU, 가격/주기).
2. `node --experimental-strip-types --env-file=.env.local scripts/provision-lemonsqueezy-products.ts`
   실행 → SKU 정확일치로 reconcile → variant id 를 env 키 블록으로 출력.
3. `add-key.sh` 로 3환경(production/preview/development) + SSOT 반영.
4. 표시명을 이후 마케팅상 변경해도(예: 이름 뒤 문구 추가) SKU 매칭이 유지되어 env 가 안 깨집니다.

USD 스토어가 생기면 **동일 이름·SKU 규약**을 사용합니다(가격만 스토어별 실값).
