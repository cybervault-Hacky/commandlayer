/**
 * Phase 7 — language and file classification.
 *
 * All of this is deterministic and name-based: CommandLayer classifies what
 * the user's page already shows (file paths, GitHub's own language label). It
 * never fetches a file, never guesses a framework from nothing, and reports
 * "unknown" rather than inventing an answer.
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  swift: 'Swift',
  cs: 'C#',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  c: 'C',
  h: 'C',
  php: 'PHP',
  scala: 'Scala',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  vue: 'Vue',
  svelte: 'Svelte',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  clj: 'Clojure',
  hs: 'Haskell',
  lua: 'Lua',
  pl: 'Perl',
  r: 'R',
  jl: 'Julia',
  tf: 'Terraform',
  proto: 'Protocol Buffers',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  md: 'Markdown',
  mdx: 'Markdown',
  txt: 'Text',
  gradle: 'Gradle',
};

const SPECIAL_FILES: Readonly<Record<string, string>> = {
  dockerfile: 'Dockerfile',
  'docker-compose.yml': 'Docker Compose',
  'docker-compose.yaml': 'Docker Compose',
  makefile: 'Makefile',
  '.gitignore': 'Git configuration',
  '.editorconfig': 'Editor configuration',
};

export function languageForPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (base.length === 0) return null;
  const special = SPECIAL_FILES[base];
  if (special) return special;
  const extension = base.includes('.') ? (base.split('.').pop() ?? '') : '';
  if (extension.length === 0) return null;
  return LANGUAGE_BY_EXTENSION[extension.toLowerCase()] ?? null;
}

/**
 * The best available language label: GitHub's own label for the repository
 * (authoritative when present), else the extension of the current path.
 */
export function languageHint(
  githubLanguage: string | null,
  path: string | null,
): string | null {
  const fromPath = languageForPath(path);
  return fromPath ?? githubLanguage;
}

const CONFIG_FILE_NAMES: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'rollup.config.js',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.ts',
  'angular.json',
  'svelte.config.js',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'vitest.config.js',
  'playwright.config.ts',
  'cypress.config.ts',
  'eslint.config.js',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  'prettier.config.js',
  '.prettierrc',
  'tsconfig.base.json',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'pipfile',
  'poetry.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'cargo.toml',
  'go.mod',
  'go.sum',
  'gemfile',
  'composer.json',
  'mix.exs',
  'pubspec.yaml',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'makefile',
  '.env.example',
  '.env.sample',
  'terraform.tf',
  'appsettings.json',
  'application.yml',
  'application.properties',
  'application.yaml',
  'codeowners',
  'dangerfile.ts',
  'turbo.json',
  'nx.json',
  'lerna.json',
]);

export function isConfigFile(path: string): boolean {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (CONFIG_FILE_NAMES.has(base)) return true;
  if (base.startsWith('.') && base.includes('rc')) return true;
  if (/\.(ya?ml|toml|ini|cfg|conf|properties)$/.test(base)) return true;
  if (path.toLowerCase().includes('.github/workflows/')) return true;
  return false;
}

export function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (/(^|\/)(__tests__|tests?|specs?|e2e)\//.test(lower)) return true;
  return /(\.|-|_)(test|spec)\.[a-z0-9]+$/.test(lower) || /_test\.(go|py|rb)$/.test(lower);
}

export function isDocumentationFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (/(^|\/)(docs?|documentation)\//.test(lower)) return true;
  return /\.(md|mdx|rst|adoc|txt)$/.test(lower);
}

const SENSITIVE_PATH = /(^|[^a-z])(auth|authentication|authorization|login|session|token|secret|password|passwd|credential|permission|acl|role|crypto|encrypt|security|payment|billing|invoice)([^a-z]|$)/i;

/**
 * Paths whose change deserves extra attention. This is a heuristic that only
 * ever produces "worth checking" wording — never a claim of a vulnerability.
 */
export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH.test(path);
}

const FRAMEWORK_BY_FILE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^next\.config\./, 'Next.js'],
  [/^nuxt\.config\./, 'Nuxt'],
  [/^angular\.json$/, 'Angular'],
  [/^svelte\.config\./, 'SvelteKit'],
  [/^astro\.config\./, 'Astro'],
  [/^remix\.config\./, 'Remix'],
  [/^pom\.xml$/, 'Maven'],
  [/^build\.gradle(\.kts)?$/, 'Gradle'],
  [/^cargo\.toml$/, 'Cargo'],
  [/^go\.mod$/, 'Go modules'],
  [/^gemfile$/, 'Bundler'],
  [/^composer\.json$/, 'Composer'],
  [/^mix\.exs$/, 'Mix'],
  [/^pubspec\.yaml$/, 'Pub'],
  [/^requirements\.txt$/, 'pip'],
  [/^pyproject\.toml$/, 'Python packaging'],
  [/^dockerfile$/, 'Docker'],
  [/^docker-compose\./, 'Docker Compose'],
  [/^turbo\.json$/, 'Turborepo'],
  [/^nx\.json$/, 'Nx'],
  [/^lerna\.json$/, 'Lerna'],
  [/^playwright\.config\./, 'Playwright'],
  [/^cypress\.config\./, 'Cypress'],
  [/^jest\.config\./, 'Jest'],
  [/^vitest\.config\./, 'Vitest'],
];

/**
 * Framework/build hints from config file NAMES visible in the captured
 * context. Deliberately name-based: no manifest is ever downloaded, and an
 * unknown stack reports no hint instead of guessing one.
 */
export function frameworkHintsFrom(files: readonly string[]): string[] {
  const hints: string[] = [];
  for (const path of files) {
    const base = path.split('/').pop()?.toLowerCase() ?? '';
    for (const [pattern, label] of FRAMEWORK_BY_FILE) {
      if (pattern.test(base) && !hints.includes(label)) hints.push(label);
    }
  }
  return hints;
}
