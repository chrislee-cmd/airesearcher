import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
      // Canvas terminal skin — dark IDE 톤 시안 (껍데기 ui). body 본문은
      // 기존 디자인 시스템 유지.
      "src/app/*/(app)/canvas/**",
      "src/components/canvas/shell/**",
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
    ignores: [
      // Canvas terminal skin — dark/neon arbitrary values 사용
      "src/app/*/(app)/canvas/**",
      "src/components/canvas/shell/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/\\[border-radius:(?:4|14|24|999|9999)px\\]/]",
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
        // text-{xs,xs-soft,sm,md,lg,xl,2xl,3xl,display}. CI lint is soft
        // (§3.8 continue-on-error: true) so these errors are visible
        // tracking, not merge blockers. Hard-flip happens after baseline=0.
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
