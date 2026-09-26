# are-we-good <!-- omit in toc -->

[![CI](https://github.com/lowlydba/are-we-good/actions/workflows/ci.yml/badge.svg)](https://github.com/lowlydba/are-we-good/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/lowlydba/are-we-good/badge)](https://scorecard.dev/viewer/?uri=github.com/lowlydba/are-we-good)
[![immutable release ruleset](https://img.shields.io/badge/immutable%20tags-active-green?logo=github)](https://github.com/lowlydba/are-we-good/rules/14655229)
[![sustainable-npm](https://img.shields.io/badge/sustainable--npm-🌱-blue?style=flat)](https://github.com/lowlydba/sustainable-npm)

Aggregates multiple job and matrix statuses into a single pass/fail status check — one name for branch protection, no matter how many jobs feed into it.

- 🔒 single dependency (GitHub's `@actions/core` package)
- 📌 immutable releases — tags are locked via [repository rulesets](https://github.com/lowlydba/are-we-good/rules)

## Why

The usual `if: always()` + `contains(needs.*.result, 'failure')` pattern treats every skipped or cancelled job as a failure unless you hand-write conditionals for each one, and it grows fragile once you add matrix or path-filtered jobs. It also can't merge multiple job results into one status name, so branch protection lists grow every time your matrix changes. are-we-good replaces that with one job, one required check, and explicit allowlists for the exceptions.

## Quick start

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
      - uses: lowlydba/are-we-good@375b418aa07a163e0614537a3fa5c51e53a757e9 # v1.0.0
        with:
          jobs: ${{ toJSON(needs) }}
```

Require the `are-we-good` check in branch protection. By default it writes a step summary and accepts skipped jobs.

## Inputs

| Input                | Default | Description                                                                                                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jobs`                | —       | **Required.** JSON from `${{ toJSON(needs) }}`.                                                                                                             |
| `allowed-to-skip`     | `""`    | Comma-separated job names allowed to be `skipped`. Empty = all jobs may be skipped.                                                                         |
| `allowed-to-cancel`   | `""`    | Comma-separated job names allowed to be `cancelled`.                                                                                                        |
| `allowed-to-fail`     | `""`    | Comma-separated job names allowed to `fail`.                                                                                                                |
| `summary`             | `true`  | Write a markdown step summary table.                                                                                                                       |
| `notify-ubuntu-slim`  | `true`  | Notice recommending [`ubuntu-slim`](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) on GitHub-hosted `ubuntu-latest` runners.  |
| `create-check-run`    | `false` | Create a uniquely-named check via the Checks API (see below). Requires `github-token`.                                                                     |
| `check-name`          | `""`    | Overrides the default `"<workflow name> / are-we-good"` check name.                                                                                         |
| `github-token`        | `""`    | Token for `create-check-run`, e.g. `${{ github.token }}`. Requires `checks: write`.                                                                         |

Non-`success`/`skipped` results (`failure`, `cancelled`) fail the check unless the job is in the matching allowlist.

## Uniquely-named check runs

The native check for the `are-we-good` job is named after the job itself, so two workflows that both call this action from a same-named job share one required check — satisfied when *either* succeeds, not both. Set `create-check-run: "true"` with a `checks: write` permission to create a per-workflow check instead:

```yaml
permissions:
  checks: write
with:
  jobs: ${{ toJSON(needs) }}
  create-check-run: "true"
  github-token: ${{ github.token }}
```

Then require the created check (e.g. `"CI / are-we-good"`) in branch protection instead.

## Output

A markdown step summary is written by default:

| Job          | Result     | Allowed   |
| ------------ | ---------- | --------- |
| `build-test` | ✅ success | ✅ passed |
| `lint`       | ✅ success | ✅ passed |

> are-we-good: ✅ All jobs passed.

The final result is also printed to the log:

![log output screenshot](assets/log-output-screenshot.png)

Enable [runner debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging) for a per-job decision trace.
