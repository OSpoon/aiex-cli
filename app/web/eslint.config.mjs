import antfu from "@antfu/eslint-config"
// @ts-check
import tsParser from "@typescript-eslint/parser"

export default antfu({
  type: "app",
  vue: true,
  pnpm: true,
  formatters: true,
  stylistic: {
    indent: 2,
    quotes: "double",
    semi: false
  }
}, {
  files: ["**/*.vue"],
  languageOptions: {
    parserOptions: {
      parser: tsParser
    }
  }
}, {
  rules: {
    "vue/block-order": ["error", { order: ["script", "template", "style"] }],
    "vue/attributes-order": "off",
    "ts/no-use-before-define": "off",
    "node/prefer-global/process": "off",
    "style/comma-dangle": ["error", "never"],
    "style/brace-style": ["error", "1tbs"],
    "regexp/no-unused-capturing-group": "off",
    "no-console": "off",
    "no-debugger": "off",
    "symbol-description": "off",
    "antfu/if-newline": "off"
  }
})
