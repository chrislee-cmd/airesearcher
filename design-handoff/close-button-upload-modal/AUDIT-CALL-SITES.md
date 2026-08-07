## 📋 적용 지점 전수 감사 — CD 회신용 (39건, 상자 지문 탐색 — `✕` grep 아님)
> 후속 교체 PR 의 SSOT. 스크린샷 2장 밖 자리는 **CD 상태 확인 요청**. `✓`·`■` 는 제외(§D5 유지 대상).

### dialog-close (모달/시트 헤더, 11)
`login-dialog.tsx:56` · `credits-bundles.tsx:392,546` · `interviews-v2/upload-progress-artifact.tsx:209` · `interviews-v2/report/share-modal.tsx:240` · `interviews-v2/report/regenerate-modal.tsx:90` · `canvas/shell/widget-fullview-modal.tsx:71` · `canvas/shell/widget-fullview-panel.tsx:98` · `canvas/fullview/fullview-header.tsx:97` · `workspace-panel.tsx:1130` · `admin/scheduling-chat-panel.tsx:472`

### banner-dismiss (토스트/배너/툴팁, 3)
`credits-status-banner.tsx:64` · `ui/onboarding-tooltip.tsx:89` · `qa/feedback-nudge-tooltip.tsx:128`

### chip-clear (칩/태그/필터 pill, 6)
`ui/chip-field.tsx:155` · `ui/badge.tsx:103` · `ui/picker/picker-parts.tsx:349` · `translate-console.tsx:5986` · `canvas/widgets/moderator-ai/ut-setup-accordion.tsx:278` · (glyph span 짝: chip-field.tsx:165·badge.tsx:107·translate-console.tsx:5993·ut-setup-accordion.tsx:285)

### row-remove (목록/파일/위젯 행 제거, 14)
`interview-analyzer.tsx:480` · `status-widget-board.tsx:379` · `interviews-v2/upload-modal.tsx:274`(계약 B 소유) · `canvas/widgets/recruiting/setup-accordion.tsx:531` · `canvas/widgets/probing/setup-accordion.tsx:121` · `canvas/widgets/probing/persona-panel.tsx:148` · `canvas/widgets/quotes-card-body.tsx:2004` · `canvas/fullview/transcript/transcript-file-list.tsx:165` · `canvas/fullview/probing/probing-thinking-rail.tsx:157` · `canvas/fullview/probing/probing-section-questions-modal.tsx:168` · `canvas/widgets/widget-guide-modal.tsx:227` · `canvas/fullview/probing/probing-spotlight.tsx:123` · `workspace-panel.tsx:695` · `admin/scheduling-chat-panel.tsx:737`

### 참고(비프로덕션)
`design-system/demos.tsx:441` · `translate-console.tsx:6259`

> **CD 확인 요청:** ① 위 매핑(특히 canvas 위젯·admin·workspace 등 스크린샷 밖 자리)이 4변종에 맞는지. ② dialog-close 변종의 fullview(90vh) 헤더 close 도 32×32 로 통일할지(현재 일부 `bordered` IconButton). ③ `--focus-ring`·`--control-h-sm/md` 승격.
