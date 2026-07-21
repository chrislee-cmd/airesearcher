import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Tokenized-arbitrary-value selectors, shared so a path-scoped block can
// LAYER extra rules on top without dropping these. ESLint flat config
// replaces (not merges) a rule's config per file when two config objects
// set the same key, so any scoped `no-restricted-syntax` block must
// re-list every selector it wants active — otherwise the global set below
// goes dark for that path. (Same same-key hazard the react/forbid-elements
// note documents.) We check both bare string literals and template-literal
// fragments so `<div className={`z-[80] ${flag}`}>` is caught too.
const RADIUS_Z_FONT_SELECTORS = [
  {
    selector: "Literal[value=/\\[border-radius:(?:4|14|24|999|9999)px\\]/]",
    message:
      "Use rounded-{xs,sm,md,full} instead of [border-radius:Npx] for tokenized values. See globals.css @theme --radius-*.",
  },
  {
    selector:
      "TemplateElement[value.raw=/\\[border-radius:(?:4|14|24|999|9999)px\\]/]",
    message:
      "Use rounded-{xs,sm,md,full} instead of [border-radius:Npx] for tokenized values. See globals.css @theme --radius-*.",
  },
  {
    selector: "Literal[value=/\\bz-\\[\\d+\\]/]",
    message:
      "Use z-{table-sticky,table-cell-sticky,table-resize,fab,modal,toast,overlay} instead of z-[N]. See globals.css @utility z-*.",
  },
  {
    selector: "TemplateElement[value.raw=/\\bz-\\[\\d+\\]/]",
    message:
      "Use z-{table-sticky,table-cell-sticky,table-resize,fab,modal,toast,overlay} instead of z-[N]. See globals.css @utility z-*.",
  },
  // Font-size literals (B-1): 781-site baseline being migrated to
  // text-{xs,xs-soft,sm,md,lg,xl,2xl,3xl,display}.
  {
    selector: "Literal[value=/\\btext-\\[\\d+(?:\\.\\d+)?px\\]/]",
    message:
      "Use text-{xs,xs-soft,sm,md,lg,xl,2xl,3xl,display} instead of text-[Npx]. See globals.css @theme --text-*. Mapping in /design-system catalog.",
  },
  {
    selector: "TemplateElement[value.raw=/\\btext-\\[\\d+(?:\\.\\d+)?px\\]/]",
    message:
      "Use text-{xs,xs-soft,sm,md,lg,xl,2xl,3xl,display} instead of text-[Npx]. See globals.css @theme --text-*. Mapping in /design-system catalog.",
  },
];

// Bracket border/shadow selectors (DS-6). Memphis drop shadows and thick
// borders had NO lint rule, so 82 sites accreted before DS-1/DS-2 swept the
// token-matching ones. These seal `shadow-[Npx_Npx…]` and `border-[Npx]` the
// same AST way radius/z-index are sealed (bare + template fragment). Applied
// as a hard error only where baseline is 0 (canvas/widgets — DS-2 #969); the
// intentional no-exact-token residuals DS-2 kept ("DS-6 lint gate baseline")
// carry a per-line eslint-disable with a reason. Other surfaces (ui/ still
// has 16 border-[2px]→border-2 pending a follow-up sweep, canvas/shell, the
// feature areas) stay unsealed and are tracked in docs/DESIGN_SYSTEM.md for a
// staged expansion — same phased approach radius/z-index took.
const BRACKET_SELECTORS = [
  {
    selector: "Literal[value=/\\bshadow-\\[\\d+px_\\d+px/]",
    message:
      "Use shadow-memphis-{2xs,xs,sm,md,lg,2xl} (+ -amore/-warning/-card color variants) instead of shadow-[Npx_Npx_…]. See globals.css @theme --shadow-memphis-*. No exact-match token (color offset / negative)? Keep it with `// eslint-disable-next-line no-restricted-syntax -- <reason>` (DS-2 convention).",
  },
  {
    selector: "TemplateElement[value.raw=/\\bshadow-\\[\\d+px_\\d+px/]",
    message:
      "Use shadow-memphis-{2xs,xs,sm,md,lg,2xl} (+ -amore/-warning/-card color variants) instead of shadow-[Npx_Npx_…]. See globals.css @theme --shadow-memphis-*. No exact-match token (color offset / negative)? Keep it with `// eslint-disable-next-line no-restricted-syntax -- <reason>` (DS-2 convention).",
  },
  {
    selector: "Literal[value=/\\bborder-\\[\\d+px\\]/]",
    message:
      "Use border / border-2 (or directional border-{t,b,l,r}-2) instead of border-[Npx]. No native match (e.g. 3px)? Keep it with `// eslint-disable-next-line no-restricted-syntax -- <reason>` (DS-2 convention).",
  },
  {
    selector: "TemplateElement[value.raw=/\\bborder-\\[\\d+px\\]/]",
    message:
      "Use border / border-2 (or directional border-{t,b,l,r}-2) instead of border-[Npx]. No native match (e.g. 3px)? Keep it with `// eslint-disable-next-line no-restricted-syntax -- <reason>` (DS-2 convention).",
  },
];

// Control-frame selectors — control 패널 규격 SSOT 강제. ControlBoardPanel
// (shell/control-board-panel.tsx) 이 컨트롤보드 아우터 프레임(cluster 폭
// max-w-2xl / 프레임 padding pt-10·pb-6 / 상단정렬 justify-start)을 단독
// 소유한다. 위젯 body 가 이 프레임 값을 손코딩하면 "상태 불변 프레임"·픽셀 정합이
// 깨지므로, 캔버스 위젯에서 이 토큰들의 하드코드를 막고 ControlBoardPanel +
// named 슬롯(.Settings/.Input/.Region/.Action) 조합으로 유도한다. 옛 프로즈-only
// "리뷰 reject" 규칙(control-board-panel.tsx 주석)의 강제화.
//   phase-1 seal — radius/z-index/DS-6 처럼 baseline 0 인 프레임 토큰부터 봉인.
//   드롭다운/슬롯 내부 gap-*/space-y- 의 광역 금지는 90KB+ 레거시 위젯 body 가
//   baseline 0 이 아니라 후속 단계로 미룸(값 자체는 SETTINGS_ROW_GAP + cluster
//   gap 열거형으로 이미 SSOT lock). 불가피한 콘텐츠 예외(coming-soon hero 등)는
//   per-line `// eslint-disable-next-line no-restricted-syntax -- <사유>`.
const CONTROL_FRAME_TOKENS = ["max-w-2xl", "pt-10", "pb-6", "justify-start"];
const CONTROL_FRAME_MESSAGE =
  "컨트롤 프레임 규격(cluster 폭 max-w-2xl / 프레임 padding pt-10·pb-6 / 상단정렬 justify-start)은 ControlBoardPanel 이 단독 소유합니다. 위젯 body 에서 손코딩하지 말고 <ControlBoardPanel> + named 슬롯(.Settings/.Input/.Region/.Action) 을 조합하세요. 불가피한 콘텐츠 예외(coming-soon hero 등)는 `// eslint-disable-next-line no-restricted-syntax -- <사유>`.";
const CONTROL_FRAME_SELECTORS = CONTROL_FRAME_TOKENS.flatMap((tok) => {
  const esc = tok.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return [
    {
      selector: `Literal[value=/\\b${esc}\\b/]`,
      message: CONTROL_FRAME_MESSAGE,
    },
    {
      selector: `TemplateElement[value.raw=/\\b${esc}\\b/]`,
      message: CONTROL_FRAME_MESSAGE,
    },
  ];
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // QA 하네스가 생성하는 증거물(비디오/트레이스/HTML 리포트의 번들 JS).
    // 커밋되지 않는 산출물이라 lint 대상에서 제외.
    "e2e/artifacts/**",
    // CD → worker 디자인 핸드오프. 프로덕션 코드 아님(.md/.dc.html/support.js
    // = CD DC 런타임 번들). 워커가 참조만 하는 자료라 lint/typecheck 대상 제외.
    "design-handoff/**",
  ]),
  // Design-system enforcement — split into TWO rules so native controls
  // (warn) and tokenized arbitrary values (error) can carry different
  // severities. Earlier this lived in two `no-restricted-syntax` scopes;
  // ESLint flat config silently overwrote one with the other (same rule
  // key), and the native-control check went dark. We use `react/forbid-
  // elements` for native control detection so the two rules don't share
  // a key anymore.
  //
  // Native form controls (warn) — surface accidental native usage in PR
  // 봉인 완료 (E-3 sealed): 131 baseline migrated across 38 slices in
  // PRs #269/#273-280/#283-297/#301-307/#309-317. Single residual native
  // <input type="range"> in credits-usage-predictor.tsx is documented
  // with eslint-disable-next-line (no Slider primitive yet — see B-? in
  // PROJECT.md §9 roadmap). New native <button>/<input>/<textarea>
  // outside primitives now fails CI.
  {
    name: "design-system/no-native-controls",
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // Primitives render the native elements themselves.
      "src/components/ui/**",
      // Intentional exemptions: marketing static page + scheduler nav chrome
      // for which no current Button variant is a clean fit.
      "src/components/landing/**",
      "src/components/scheduler/**",
      // Mock lab — primitive 채택 전 단계. canvas-lab 위젯이 production
      // 으로 승격될 때 strict 적용. (`*` 는 [locale] segment 매칭)
      "src/app/*/(canvas-lab)/**",
    ],
    rules: {
      "react/forbid-elements": [
        "error",
        {
          forbid: [
            {
              element: "button",
              message:
                "Use <Button> from @/components/ui/button instead of native <button>. (variant=link/destructive-link cover text-only patterns; size=cta covers pill CTAs. For icon-only triggers use <IconButton>. For 4px-radius chrome use <ChromeButton>.)",
            },
            {
              element: "input",
              message:
                "Use <Input> from @/components/ui/input instead of native <input>. (For type=checkbox use <Checkbox>. For 4px-radius chrome inputs use <ChromeInput> from @/components/ui/chrome-input.)",
            },
            {
              element: "textarea",
              message:
                "Use <Textarea> from @/components/ui/textarea instead of native <textarea>.",
            },
          ],
        },
      ],
    },
  },
  // Tokenized arbitrary values (error) — locked in by PRs #249 (z-index)
  // and #250 (radius). The 4 outlier radius values (2/3/8/10px, 22 sites)
  // are intentionally allowed through — queued for a follow-up PR after
  // design decides whether to normalize or extend the scale. text-[Npx]
  // is NOT blocked yet — font-size tokens pending design alignment (B-1).
  //
  // We check both bare string literals and template-literal fragments so
  // `<div className={`z-[80] ${flag}`}>` is caught too.
  {
    name: "design-system/no-hardcoded-tokens",
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...RADIUS_Z_FONT_SELECTORS],
    },
  },
  // Bracket border/shadow gate (DS-6) — hard(error) scope. canvas/widgets is
  // the one surface DS-2 (#969) drove to baseline 0 for the token-matching
  // patterns, so it can hard-flip today. This block LAYERS the bracket
  // selectors on top of the global token set; because a scoped
  // no-restricted-syntax replaces (not merges) the global one for these
  // files, we spread RADIUS_Z_FONT_SELECTORS back in so radius/z/font stay
  // enforced here too. The CI "Design-system lint (blocking)" job selects by
  // ruleId (no-restricted-syntax), so it picks these up automatically — no
  // ci.yml change needed. Residual no-exact-token brackets carry per-line
  // eslint-disable + reason (see the 9 sites DS-2 flagged as DS-6 baseline).
  //
  // This block ALSO carries the control-frame selectors (CONTROL_FRAME_
  // SELECTORS) — same canvas/widgets scope, same no-restricted-syntax key, so
  // they must live in the SAME block (a second block for the same files would
  // replace, not merge, this rule and drop the bracket/radius selectors). The
  // CI "Design-system lint (blocking)" job picks them up by ruleId.
  {
    name: "design-system/no-bracket-hardcodes",
    files: ["src/components/canvas/widgets/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...RADIUS_Z_FONT_SELECTORS,
        ...BRACKET_SELECTORS,
        ...CONTROL_FRAME_SELECTORS,
      ],
    },
  },
  // Insights Analyzer — strict design-system enforcement (errored,
  // greenfield). The merged insights surface is preview-gated and has
  // no JSX written yet, so we error here from day 1 rather than letting
  // the legacy `warn`-level debt the rest of the codebase carries seep
  // in. If a missing primitive is needed (e.g. <Select>), add it to
  // src/components/ui/ in its own PR before authoring the consumer.
  {
    name: "design-system/insights-analyzer-strict",
    files: [
      "src/app/[locale]/(app)/insights-analyzer/**/*.{ts,tsx}",
      "src/components/insights/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message:
            "Use <Button> / <ChromeButton> / <IconButton> from @/components/ui — native <button> is errored inside insights-analyzer.",
        },
        {
          selector: 'JSXOpeningElement[name.name="input"]',
          message:
            "Use <Input> / <Checkbox> from @/components/ui — native <input> is errored inside insights-analyzer.",
        },
        {
          selector: 'JSXOpeningElement[name.name="textarea"]',
          message:
            "Use <Textarea> from @/components/ui — native <textarea> is errored inside insights-analyzer.",
        },
        {
          selector: 'JSXOpeningElement[name.name="dialog"]',
          message:
            "Use <Modal> from @/components/ui/modal — native <dialog> is errored inside insights-analyzer.",
        },
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message:
            "No <Select> primitive exists yet — add one to @/components/ui in its own PR before using native <select> inside insights-analyzer.",
        },
      ],
    },
  },
]);

export default eslintConfig;
