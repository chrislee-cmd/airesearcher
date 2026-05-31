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
            "Use <Button> from @/components/ui/button instead of native <button>. (variant=link/destructive-link cover text-only patterns; size=cta covers pill CTAs.)",
        },
        {
          selector: 'JSXOpeningElement[name.name="input"]',
          message:
            "Use <Input> from @/components/ui/input instead of native <input>.",
        },
        {
          selector: 'JSXOpeningElement[name.name="textarea"]',
          message:
            "Use <Textarea> from @/components/ui/textarea instead of native <textarea>.",
        },
      ],
    },
  },
]);

export default eslintConfig;
