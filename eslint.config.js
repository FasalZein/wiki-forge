import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import boundaries from "eslint-plugin-boundaries";

const DOMAINS = [
  "slice",
  "hierarchy",
  "maintenance",
  "verification",
  "session",
  "protocol",
  "retrieval",
  "research",
];

const publicEntries = DOMAINS.map((domain) => ({
  type: `${domain}-public`,
  pattern: `src/${domain}/index.ts`,
  mode: "full",
}));

const internalElements = DOMAINS.map((domain) => ({
  type: domain,
  pattern: `src/${domain}/**/*`,
  mode: "full",
}));

const dependencyRules = [
  { from: { type: "lib" }, allow: { to: { type: "lib" } } },
  ...DOMAINS.map((domain) => {
    const otherDomainsPublic = DOMAINS.filter((other) => other !== domain).map((other) => `${other}-public`);
    return {
      from: { type: [domain, `${domain}-public`] },
      allow: { to: { type: [domain, `${domain}-public`, "lib", ...otherDomainsPublic] } },
    };
  }),
];

export default [
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/index.ts",
      "src/system.ts",
      "src/cli-shared.ts",
      "src/constants.ts",
      "src/git-utils.ts",
      "src/module-format.ts",
      "src/types.ts",
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      boundaries,
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
      },
      "boundaries/include": ["src/**/*"],
      "boundaries/ignore": [
        "src/index.ts",
        "src/system.ts",
        "src/cli-shared.ts",
        "src/constants.ts",
        "src/git-utils.ts",
        "src/module-format.ts",
        "src/types.ts",
      ],
      "boundaries/elements": [
        ...publicEntries,
        ...internalElements,
        { type: "lib", pattern: "src/lib/**/*", mode: "full" },
      ],
    },
    rules: {
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "export * is banned; list exports explicitly in each domain's index.ts",
        },
      ],
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: dependencyRules,
        },
      ],
    },
  },
];
