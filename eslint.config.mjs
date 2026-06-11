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
  // Design-system boundary: deter new native form controls outside ui/.
  // Promote `warn` → `error` after the top-5 highest-density pages
  // (workspace-panel / interview-analyzer / recruiting-brief / translate-
  // console / scheduler-attendees) finish migrating off native <button>
  // / <input> / <textarea>.
  {
    name: "design-system/no-native-controls",
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // Primitives themselves naturally render the native elements.
      "src/components/ui/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message:
            "Use <Button> from @/components/ui/button instead of native <button>. (variant=link/destructive-link cover text-only patterns; size=cta covers pill CTAs. For icon-only triggers use <IconButton>. For 4px-radius chrome use <ChromeButton>.)",
        },
        {
          selector: 'JSXOpeningElement[name.name="input"]',
          message:
            "Use <Input> from @/components/ui/input instead of native <input>. (For type=checkbox use <Checkbox>. For 4px-radius chrome inputs use <ChromeInput> from @/components/ui/chrome-input.)",
        },
        {
          selector: 'JSXOpeningElement[name.name="textarea"]',
          message:
            "Use <Textarea> from @/components/ui/textarea instead of native <textarea>.",
        },
      ],
    },
  },
  // Design-system tokens — block hardcoded Tailwind arbitrary values for
  // properties that already have semantic tokens. Lock in the radius/z-index
  // sweep (PRs #249, #250) so the next hand on the codebase doesn't quietly
  // reintroduce `[border-radius:14px]` / `z-[80]` next to the new utilities.
  //
  // Scope:
  // - `[border-radius:{4|14|24|999|9999}px]` → use `rounded-{xs,sm,md,full}`.
  //   The 4 outlier values (2/3/8/10px, 22 sites) are intentionally allowed
  //   through — they're queued for a follow-up PR after design decides
  //   whether to normalize them or extend the scale.
  // - `z-[\d+]` → use `z-{table-sticky,table-cell-sticky,table-resize,fab,
  //   modal,toast,overlay}`. Full block — no outliers.
  // - `text-[Npx]` is NOT blocked yet — the font-size tokens are still
  //   pending design alignment (B-1).
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
