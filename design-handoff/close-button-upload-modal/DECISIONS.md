# DECISIONS — 닫기버튼(A) + 업로드모달(B) (writer 확정, 2026-08-07)

> CD 번들 xbtn.zip 인바운드 검토. HANDOFF/BUILD-SPEC §6 열린 결정 + 갭.

## ⚠️ 갭 — DESIGN-SSOT-MASTER.dc.html 부재 (CD 회부 필요)
두 계약서가 `DESIGN-SSOT-MASTER.dc.html` 의 §A2·§A4·§B1·§B2·§B3·§C1·§C3·§D1·§D4·§D5 를 SSOT 로 참조하나 **레포에 이 파일이 없다**(design-handoff 어디에도). 토큰 참조(processing 시그널 `--color-processing #8b5cf6` 등)는 globals.css 에 실재하나, dc.html §섹션 참조는 워커가 못 읽는다.
- **조치**: CD 가 `DESIGN-SSOT-MASTER.dc.html` 을 전달해야 close-button/upload-modal 정밀 포팅 가능. 없으면 워커는 BUILD-SPEC §1 인라인 값 + CLOSE-BUTTON-AUDIT.dc.html 로만 진행(섹션 근거 대조 불가). **사용자→CD 전달 요청.**

## 계약 A (닫기버튼 전역)
- 채택. ✕ 문자 유지(SVG 금지, §D5 판정 불변). 상자만 교체 — 4변종(row-remove·dialog-close·chip-clear·banner-dismiss).
- **선행 스텝**: 워커가 레거시 닫기버튼 **적용 지점 전수 목록을 먼저 뽑아 CD 회신**(스크린샷 2장 밖 자리는 CD 미확인) → 그 후 교체. 기존 컴포넌트 편집 금지, 신규 생성 후 호출부 교체.

## 계약 B (업로드 모달)
- 채택. **§6 열린결정 = rose 밴드 헤더 확정** (writer): 이 업로드 모달은 현재 **인터뷰 결과 전용**(`interviews-v2/upload-modal.tsx`)이므로 rose 밴드 + border-b. (후에 여러 위젯 공유로 승격되면 흰 헤더로 중립화 — 그때 재결정.)
- **A 선행**: B 의 ✕ 는 A 컴포넌트 호출만. A 머지 후 B 착수.

## 진행 배너 소유권 (B §3 ↔ #678)
- 카드 본문 업로드 진행 배너를 **B 와 #678 이 공동 접촉**. 중복 편집 방지:
  - **#678(업로드 상태 정합성)이 배너 소유** — 로직(거짓실패 수렴·카운트 분해) + **CD B §3 processing 시그널 비주얼(붉은 라벨 폐기 → violet #8b5cf6 진행바·processing bg)**을 함께 적용.
  - **B 는 업로드 모달 자체**(프레임·드롭존·파일행·푸터)만. 배너는 #678 로 위임(B 스펙에 명시).
- 근거: 붉은 "변환 중 10" 라벨이 "진행 vs 실패" 안 읽히는 문제 = #678 진단의 시각적 짝. 한 워커가 배너의 로직+비주얼을 함께 고쳐야 정합.

## done.zip (인터뷰 결과 업데이트)
- 변경 = 카드 완료 상태(S1·1e) `abstract 요약카드` → 전사록 `TG_done` 패턴(완료 타일 ✓ + 전체보기 CTA, 별도 요약박스 없음). 나머지 동일.
- 별도 스펙(#684)으로 #593 카드 완료상태 재작업.
