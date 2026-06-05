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
            "Use <Input> from @/components/ui/input instead of native <input>. (For type=checkbox use <Checkbox> from @/components/ui/checkbox.)",
        },
        {
          selector: 'JSXOpeningElement[name.name="textarea"]',
          message:
            "Use <Textarea> from @/components/ui/textarea instead of native <textarea>.",
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
