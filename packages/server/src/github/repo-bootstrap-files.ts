/** 新建 `playwright-test-code` 仓库时写入的 CI / Node 引导文件 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGE_LOCK_JSON = readFileSync(join(__dirname, 'bootstrap', 'package-lock.json'), 'utf8')

export type RepoBootstrapFile = {
  path: string
  content: string
  commitMessage: string
}

export const REPO_BOOTSTRAP_FILES: RepoBootstrapFile[] = [
  {
    path: '.github/workflows/playwright.yml',
    commitMessage: 'chore: add Playwright GitHub Actions workflow',
    content: `name: Playwright Tests

on:
  push:
    branches: [main, master]
    paths:
      - 'tests/**'
      - 'scripts/**'
      - 'playwright.config.ts'
      - 'package.json'
      - 'package-lock.json'
      - '.browser-test-agent.json'
      - '.github/workflows/**'
  pull_request:
    branches: [main, master]
    paths:
      - 'tests/**'
      - 'scripts/**'
      - 'playwright.config.ts'
      - 'package.json'
      - 'package-lock.json'
      - '.browser-test-agent.json'
      - '.github/workflows/**'
  workflow_dispatch:
    inputs:
      base_url:
        description: '目标页面 URL（覆盖 Secrets / .browser-test-agent.json）'
        required: false
        type: string

concurrency:
  group: playwright-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Run Playwright specs
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run Playwright tests
        env:
          BASE_URL: \${{ inputs.base_url || secrets.BASE_URL }}
          TEST_USERNAME: \${{ secrets.TEST_USERNAME }}
          TEST_PASSWORD: \${{ secrets.TEST_PASSWORD }}
          RUN_TEST_ENV_KEYS: \${{ secrets.RUN_TEST_ENV_KEYS }}
          TEST_TIMEOUT_MS: '120000'
          CI: 'true'
        run: npm test

      - name: Upload runner logs on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-ci-logs-\${{ github.run_id }}
          path: |
            test-results/
            playwright-report/
          if-no-files-found: ignore
          retention-days: 7
`,
  },
  {
    path: 'package.json',
    commitMessage: 'chore: add Node.js Playwright project scaffold',
    content: `{
  "name": "playwright-test-code",
  "private": true,
  "description": "Browser Test Agent 自动生成的 Playwright 测试用例",
  "scripts": {
    "test": "node scripts/run-tests.mjs",
    "test:headed": "HEADED=1 node scripts/run-tests.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "playwright": "^1.50.0"
  }
}
`,
  },
  {
    path: 'package-lock.json',
    commitMessage: 'chore: add package-lock for CI npm cache',
    content: PACKAGE_LOCK_JSON,
  },
  {
    path: 'playwright.config.ts',
    commitMessage: 'chore: add Playwright config',
    content: `import { defineConfig, devices } from '@playwright/test';

/** 供 \`playwright install\` / IDE 使用；CI 实际执行见 scripts/run-tests.mjs */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
`,
  },
  {
    path: '.gitignore',
    commitMessage: 'chore: add gitignore',
    content: `node_modules/
test-results/
playwright-report/
blob-report/
.env
.DS_Store
`,
  },
  {
    path: '.env.example',
    commitMessage: 'chore: add env example',
    content: `# 本地运行 npm test 时使用
BASE_URL=https://example.com/page
TEST_USERNAME=
TEST_PASSWORD=
# 可选：逗号分隔的额外注入键（与 Agent 服务端 RUN_TEST_ENV_KEYS 一致）
# RUN_TEST_ENV_KEYS=
`,
  },
  {
    path: 'scripts/run-tests.mjs',
    commitMessage: 'chore: add Agent-compatible Playwright runner',
    content: `/**
 * 与 Browser Test Agent 服务端 runner 对齐：按序执行各 test 回调体，并注入 testEnv。
 * 生成用例使用 testEnv.TEST_USERNAME 等，而非 Playwright 内置 fixture。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

function buildTestEnv() {
  const keys = new Set(['TEST_USERNAME', 'TEST_PASSWORD']);
  for (const k of String(process.env.RUN_TEST_ENV_KEYS ?? '').split(/[,;\\s]+/)) {
    if (k.trim()) keys.add(k.trim());
  }
  const out = {};
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }
  return out;
}

function hasTestCredentials(testEnv) {
  return Boolean(testEnv.TEST_USERNAME && testEnv.TEST_PASSWORD);
}

/** 含 testEnv 凭据或明显为登录流程的 spec，在无 Secrets 时跳过以免 CI 误报 */
function shouldSkipSpecWithoutCredentials(content, testEnv) {
  if (hasTestCredentials(testEnv)) return false;
  if (/\\btestEnv\\.(TEST_USERNAME|TEST_PASSWORD)\\b/.test(content)) return true;
  return /moonx-login|login-modal|登录弹|登入弹|test\\([^)]*登录/i.test(content);
}

/** 与当前 BASE_URL 不匹配或含已废弃臆造 selector 的旧版 spec */
function skipSpecReason(content, baseUrl) {
  const url = String(baseUrl ?? '').toLowerCase();
  if (/moonx-login/.test(content) && !url.includes('moonx')) {
    return '含 moonx-login 选择器，与当前 BASE_URL 不匹配（请用 Agent 按 DSL 重新生成）';
  }
  if (/\\.user-avatar|\\.header-user|\\[data-testid="user-avatar"\\]/.test(content)) {
    return '含已废弃臆造 selector（.user-avatar 等），请由 Agent 重新生成';
  }
  return null;
}

function extractAllTestCallbackBodies(source) {
  const bodies = [];
  let pos = 0;
  while (pos < source.length) {
    const slice = source.slice(pos);
    const head = /\\btest\\s*(?:\\.only\\s*)?\\(/.exec(slice);
    if (!head) break;
    const absHead = pos + head.index;
    const arrow = source.indexOf('=>', absHead);
    if (arrow === -1) {
      pos = absHead + 1;
      continue;
    }
    const bodyOpen = source.indexOf('{', arrow);
    if (bodyOpen === -1 || bodyOpen < arrow) {
      pos = absHead + 1;
      continue;
    }
    let depth = 0;
    let i = bodyOpen;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          bodies.push(source.slice(bodyOpen + 1, i));
          pos = i + 1;
          break;
        }
      }
    }
    if (i >= source.length) break;
  }
  return bodies;
}

async function readDefaultBaseUrl(cwd) {
  if (process.env.BASE_URL?.trim()) return process.env.BASE_URL.trim();
  try {
    const raw = await readFile(join(cwd, '.browser-test-agent.json'), 'utf8');
    const json = JSON.parse(raw);
    const url = String(json.defaultBaseUrl ?? '').trim();
    if (url) return url;
  } catch {
    /* optional */
  }
  return '';
}

async function runSpecOnPage(page, content, perTestTimeout, testEnv, logs) {
  const bodies = extractAllTestCallbackBodies(content).filter((b) => b.trim());
  if (bodies.length === 0) {
    throw new Error('未能解析 test 体：需要 test(..., async (...) => { ... })');
  }
  const AsyncConstructor = Object.getPrototypeOf(async function () {}).constructor;
  let passed = 0;
  let failed = 0;
  for (let bi = 0; bi < bodies.length; bi++) {
    logs.push(\`[runner] 执行第 \${bi + 1}/\${bodies.length} 段 test 体\`);
    const runner = new AsyncConstructor('page', 'expect', 'testEnv', \`"use strict";\\n\${bodies[bi]}\`);
    try {
      await Promise.race([
        runner(page, expect, testEnv),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(\`第 \${bi + 1} 段测试超过 \${perTestTimeout}ms\`)), perTestTimeout),
        ),
      ]);
      passed++;
    } catch (e) {
      failed++;
      logs.push(\`[error] 第 \${bi + 1} 段: \${String(e)}\`);
    }
  }
  logs.push('[runner] 全部用例执行完毕');
  return { passed, failed };
}

async function main() {
  const cwd = process.cwd();
  const baseUrl = await readDefaultBaseUrl(cwd);
  if (!baseUrl) {
    console.error('缺少 BASE_URL：请设置环境变量，或在仓库 Secrets 中配置 BASE_URL，或由 Agent 上传 .browser-test-agent.json');
    process.exit(1);
  }

  const testsDir = join(cwd, 'tests');
  let entries;
  try {
    entries = (await readdir(testsDir)).filter((f) => f.endsWith('.spec.ts')).sort();
  } catch {
    console.error('未找到 tests/ 目录');
    process.exit(1);
  }
  if (entries.length === 0) {
    console.log('tests/ 下无 *.spec.ts，跳过');
    process.exit(0);
  }

  const testEnv = buildTestEnv();
  if (!hasTestCredentials(testEnv)) {
    console.log('[runner] 未配置 TEST_USERNAME/TEST_PASSWORD：将跳过依赖登录凭据的 spec 文件');
  }
  const totalTimeout = Number(process.env.TEST_TIMEOUT_MS ?? 120_000);
  const perTestTimeout = Math.max(15_000, Math.floor(totalTimeout / 4));
  const headless = process.env.HEADED !== '1' && process.env.HEADED !== 'true';

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const browser = await chromium.launch({ headless });
  try {
    for (const file of entries) {
      const content = await readFile(join(testsDir, file), 'utf8');
      const incompatible = skipSpecReason(content, baseUrl);
      if (incompatible || shouldSkipSpecWithoutCredentials(content, testEnv)) {
        console.log(\`\\n=== \${file} ===\`);
        console.log(
          incompatible
            ? \`[skip] \${incompatible}\`
            : '[skip] 需要 Actions Secrets 或 .env 中的 TEST_USERNAME、TEST_PASSWORD（登录类用例）',
        );
        totalSkipped++;
        continue;
      }
      console.log(\`\\n=== \${file} ===\`);
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('console', (msg) => console.log(\`[console.\${msg.type()}] \${msg.text()}\`));
      page.on('pageerror', (err) => console.log(\`[pageerror] \${err.message}\`));
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      const logs = [];
      const { passed, failed } = await runSpecOnPage(page, content, perTestTimeout, testEnv, logs);
      for (const line of logs) console.log(line);
      totalPassed += passed;
      totalFailed += failed;
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(\`\\n合计：通过 \${totalPassed} · 失败 \${totalFailed} · 跳过 \${totalSkipped}\`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`,
  },
  {
    path: 'README.md',
    commitMessage: 'docs: add CI and local run instructions',
    content: `# playwright-test-code

由 [Browser Test Agent](https://github.com) 自动生成的 Playwright 测试用例仓库。

## 目录

- \`tests/\` — \`.spec.ts\` 测试文件（Agent 自动上传）
- \`scripts/run-tests.mjs\` — 与 Agent 服务端一致的 runner（注入 \`testEnv\`）
- \`.github/workflows/playwright.yml\` — GitHub Actions 自动化

## GitHub Actions

在仓库 **Settings → Secrets and variables → Actions** 中配置：

| Secret | 说明 |
|--------|------|
| \`BASE_URL\` | 被测页面 URL（也可写在 \`.browser-test-agent.json\`） |
| \`TEST_USERNAME\` | 登录账号（**含登录类 spec 时必填**） |
| \`TEST_PASSWORD\` | 登录密码（**含登录类 spec 时必填**） |
| \`RUN_TEST_ENV_KEYS\` | 额外注入键名，逗号分隔（可选） |

未配置登录凭据时，runner 会**跳过**引用 \`testEnv\` 或标题含「登录」的 spec，避免 \`fill(undefined)\` 导致 CI 失败；搜索等非登录用例仍会执行。

推送 \`tests/\` 变更或手动 **Run workflow** 即可在 Node 20 + Chromium 环境执行。

## 本地运行

\`\`\`bash
npm install
npx playwright install chromium
cp .env.example .env   # 编辑 BASE_URL 与凭据
export $(grep -v '^#' .env | xargs) && npm test
\`\`\`
`,
  },
]
