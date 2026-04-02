# are-we-good

[![CI](https://github.com/lowlydba/are-we-good/actions/workflows/ci.yml/badge.svg)](https://github.com/lowlydba/are-we-good/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![sustainable-npm](https://img.shields.io/badge/sustainable--npm-🌱-blue?style=flat)](https://github.com/lowlydba/sustainable-npm)

Aggregates multiple job and matrix statuses into a single pass/fail status check.

* 🔒 single dependency (Github's `@actions/core` package)
* 📌 immutable releases — tags are locked via [repository rulesets](https://github.com/lowlydba/are-we-good/rules)

## Table of Contents

- [Tutorial](#tutorial)
- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## Tutorial

This quick start shows the smallest complete setup.

1. Add your normal CI jobs.
2. Add a final `are-we-good` job that depends on those jobs.
3. Pass `jobs: ${{ toJSON(needs) }}`.
4. Set `if: always()` so the final job runs even when upstream jobs fail.

```yaml
jobs:
  test:
    strategy:
      matrix:
        node: [22, 24]
    runs-on: ubuntu-slim
    steps:
      - run: npm test

  are-we-good:
    runs-on: ubuntu-slim
    needs: [test]
    if: always()
    steps:
      - uses: actions/checkout@v6
      - uses: lowlydba/are-we-good@v1
        with:
          jobs: ${{ toJSON(needs) }}
```

Expected result:
- `are-we-good` produces a single pass/fail check you can require in branch protection.
- A markdown step summary is written by default.

## How-to Guides

### Allow specific jobs to fail or be cancelled

Use allowlists when some jobs are advisory.

```yaml
jobs:
  test:
    strategy:
      matrix:
        node: [22, 24]
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint

  are-we-good:
    runs-on: ubuntu-latest
    needs: [test, lint]
    if: always()
    steps:
      - uses: actions/checkout@v6
      - uses: lowlydba/are-we-good@v1
        with:
          jobs: ${{ toJSON(needs) }}
          allowed-to-fail: lint
          allowed-to-cancel: lint
```

### Require explicit skip allowlists

By default, skipped jobs are accepted for all jobs. To require explicit skip permissions, set `allowed-to-skip` to a non-empty list.

```yaml
with:
  jobs: ${{ toJSON(needs) }}
  allowed-to-skip: docs-only-job
```

### Disable the step summary

```yaml
with:
  jobs: ${{ toJSON(needs) }}
  summary: "false"
```

### Troubleshoot decisions with debug logs

Enable runner debug mode in GitHub Actions to emit per-job decision logs.

- Docs: [Enable debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging)

## Reference

### Inputs

| Input               | Required | Default  | Description |
|---------------------|----------|----------|-------------|
| jobs                |  yes   | —        | JSON string of job results. Pass ${{ toJSON(needs) }} from the calling workflow. |
| allowed-to-skip     | no       | ""       | Comma-separated list of job names whose skipped result is acceptable. Empty = all jobs may be skipped (wildcard). |
| allowed-to-cancel   | no       | ""       | Comma-separated list of job names whose cancelled result is acceptable. |
| allowed-to-fail     | no       | ""       | Comma-separated list of job names whose failure result is acceptable. |
| summary             | no       | "true"   | Set to "false" to disable the markdown step summary table. |

### Outputs

| Key          | Value                  |
|--------------|------------------------|
| result       | "success" \| "failure" |
| are-we-good  | "true" \| "false"      |

### Decision table

| Result      | Default behavior       | Override input      |
|-------------|------------------------|---------------------|
| success     | ✅ always ok           | n/a                 |
| skipped     | ✅ ok for all jobs     | allowed-to-skip     |
| cancelled   | ❌ fails               | allowed-to-cancel   |
| failure     | ❌ fails               | allowed-to-fail     |

### Calling workflow contract

- Run this action in a final job.
- Use `needs: [job-a, job-b, ...]`.
- Use `if: always()`.
- Pass `jobs: ${{ toJSON(needs) }}`.

## Explanation

### Why this action exists

GitHub branch protection rules require you to list *every* required status check by name. When you run a
[matrix build](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs) or several
parallel jobs, that list grows fast — and every time you add or rename a matrix dimension you have to
update your branch protection settings too.

In a monorepo, the situation is even worse: jobs that are filtered by changed paths may be skipped on a
given PR, yet still show up as required checks, so the PR can never merge cleanly without special tooling.

are-we-good solves both problems by running as a final job (with `needs: [job-a, job-b, ...]` and
`if: always()`) that reports a single pass/fail.

By default the action writes a step summary table, and in debug mode it logs every per-job decision so you can trace why the final result was chosen.

