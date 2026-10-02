#!/usr/bin/env node
// Render an Istanbul/V8 `coverage-summary.json` as a Markdown table (for $GITHUB_STEP_SUMMARY).
// Usage: node scripts/ci/coverage-summary.mjs <coverage-summary.json> [title]
import { readFileSync } from 'node:fs';

const [file, title = 'Coverage'] = process.argv.slice(2);
if (!file) {
  console.error('usage: coverage-summary.mjs <coverage-summary.json> [title]');
  process.exit(2);
}

const { total } = JSON.parse(readFileSync(file, 'utf8'));
const rows = Object.entries(total)
  .filter(([, metric]) => typeof metric === 'object' && metric !== null && metric.total > 0)
  .map(([name, m]) => `| ${name} | ${m.covered}/${m.total} | ${m.pct}% |`);

console.log([`### ${title}`, '', '| Metric | Covered | % |', '|---|---|---|', ...rows].join('\n'));
