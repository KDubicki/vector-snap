/**
 * Commit message rules — Conventional Commits.
 * See docs/10-development-workflow.md and docs/12-ci-cd.md.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot always writes "Bump …" (sentence case) and long group titles. Its commits are
  // identified by its sign-off trailer; human commits keep the full rules.
  ignores: [(message) => message.includes('Signed-off-by: dependabot[bot] <support@github.com>')],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'backend',
        'frontend',
        'api',
        'editor',
        'docker',
        'docs',
        'adr',
        'ci',
        'deps',
        'deps-dev',
        'release',
      ],
    ],
    // Bodies and footers often contain URLs or generated text (e.g. Dependabot); don't hard-wrap them.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
