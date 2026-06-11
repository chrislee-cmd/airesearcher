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
  // diffs but don't block CI yet (131 violations baseline; per-page
  // migration follows). Promote to error once baseline reaches 0.
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
    ],
    rules: {
      "react/forbid-elements": [
        "warn",
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
