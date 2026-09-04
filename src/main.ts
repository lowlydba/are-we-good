/**
 * GitHub Actions entry point.
 *
 * Reads action inputs, delegates all logic to evaluateJobs(), writes the step
 * summary (optional), emits debug logs when the runner is in debug mode, and
 * reports the final result via @actions/core.
 */

import process from "node:process";
import { existsSync } from "node:fs";
import * as core from "@actions/core";
import {
  evaluateJobs,
  shouldRecommendUbuntuSlim,
  deriveCheckName,
  type Outcome,
  type JobDetail,
} from "./index.ts";

/** ─── Summary ───────────────────────────────────────────────────────────── */

/** Emoji for each possible job result. */
const RESULT_EMOJI: Record<string, string> = {
  success: "✅",
  skipped: "⏭️",
  cancelled: "🚫",
  failure: "❌",
};

/** Returns a human-readable note for non-success acceptable results. */
function acceptanceNote(detail: JobDetail): string {
  switch (detail.reason) {
    case "skipped-wildcard":
      return "skipped (wildcard)";
    case "skipped-allowlisted":
      return "skipped (allowed)";
    case "cancelled-allowlisted":
      return "cancelled (allowed)";
    case "failure-allowlisted":
      return "failure (allowed)";
    default:
      return "";
  }
}

/**
 * Writes a markdown step summary table to the GitHub Actions job summary.
 * Each row shows the job name, its result, and its final disposition.
 */
async function writeSummary(outcome: Outcome): Promise<void> {
  const rows = outcome.details.map((d) => {
    const emoji = RESULT_EMOJI[d.result] ?? "❓";
    const note = acceptanceNote(d);
    const status = d.acceptable ? (note ? `✅ ${note}` : "✅ passed") : "❌ failed";
    return [d.name, `${emoji} ${d.result}`, status];
  });

  await core.summary
    .addHeading("are-we-good", 3)
    .addTable([
      [
        { data: "Job", header: true },
        { data: "Result", header: true },
        { data: "Allowed", header: true },
      ],
      ...rows,
    ])
    .addRaw(`\n\n> ${outcome.message}`)
    .write();
}

/** ─── Debug logging ─────────────────────────────────────────────────────── */

/** Human-readable label for each AcceptanceReason. */
const REASON_LABEL: Record<string, string> = {
  success: "passed",
  "skipped-wildcard": "all skips are allowed",
  "skipped-allowlisted": "on the skip allow list",
  "cancelled-allowlisted": "on the cancel allow list",
  "failure-allowlisted": "on the failure allow list",
  rejected: "not allowed",
};

/** Emits a debug log entry for every job decision, then the final result. */
function logDebugDetails(outcome: Outcome): void {
  core.debug(`[are-we-good] Evaluating ${outcome.details.length} job(s)`);

  for (const d of outcome.details) {
    const icon = d.acceptable ? "✅" : "❌";
    const label = REASON_LABEL[d.reason] ?? d.reason;
    core.debug(`[are-we-good] "${d.name}" result=${d.result} ${icon} ${label}`);
  }

  core.debug(`[are-we-good] Final result: ${outcome.result}`);
}

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";

const GOOD_BANNER = [
  "  _____   ____   ____   _____ ",
  " / ____| / __ \\ / __ \\ |  __ \\",
  "| |  __ | |  | | |  | || |  | |",
  "| | |_ || |  | | |  | || |  | |",
  "| |__| || |__| | |__| || |__| |",
  " \\_____| \\____/ \\____/ |_____/ ",
];

const NOT_GOOD_BANNER = [
  " _   _  ____ _______    _____  ____   ____  _____  ",
  "| \\ | |/ __ \\__   __|  / ____|/ __ \\ / __ \\|  __ \\",
  "|  \\| | |  | | | |    | |  __| |  | | |  | | |  | |",
  "| . ` | |  | | | |    | | |_ | |  | | |  | | |  | |",
  "| |\\  | |__| | | |    | |__| | |__| | |__| | |__| |",
  "|_| \\_|\\____/  |_|     \\_____|\\____/ \\____/|_____/ ",
];

function printFinalBanner(result: "success" | "failure"): void {
  const banner = result === "success" ? GOOD_BANNER : NOT_GOOD_BANNER;
  const color = result === "success" ? ANSI_GREEN : ANSI_RED;
  const coloredBanner = banner.map((line) => `${color}${line}${ANSI_RESET}`).join("\n");
  console.log(`\n${coloredBanner}`);
}

/** ─── Runner notices ────────────────────────────────────────────────────── */

/**
 * Emits a step notice recommending `ubuntu-slim` when running on a
 * GitHub-hosted `ubuntu-latest` (or other stock Ubuntu VM) runner, to help
 * right-size compute for a lightweight action like this one. `ImageOS`
 * reports the same value ("ubuntu24", etc.) on both `ubuntu-latest` and
 * `ubuntu-slim`, so the env-based check alone can't tell them apart — it's
 * paired with a `/run/.containerenv` check, which only exists inside
 * `ubuntu-slim`'s containerized runtime, to skip runners that are already slim.
 */
function notifyUbuntuSlimIfApplicable(): void {
  if (!core.getBooleanInput("notify-ubuntu-slim")) return;

  const isAlreadySlim = existsSync("/run/.containerenv");
  if (shouldRecommendUbuntuSlim(process.env, isAlreadySlim)) {
    core.notice(
      "Running on ubuntu-latest — consider switching to ubuntu-slim to right-size the runner for this lightweight action.",
    );
  }
}

/** ─── Custom check run ──────────────────────────────────────────────────── */

/**
 * Optionally creates a standalone check run via the GitHub Checks API,
 * named per-workflow by default (see `deriveCheckName`). This sidesteps the
 * job-name collision footgun: when this action runs from a job with the
 * same name in two or more workflows, their native job-level checks share
 * one status-check name, so branch protection is satisfied by either one
 * succeeding instead of requiring all of them. A custom check run created
 * here is named independently of the job, so each workflow gets its own
 * uniquely-named required check.
 *
 * Best-effort: failures are logged as warnings and never override the
 * action's own pass/fail result.
 */
async function maybeCreateCheckRun(outcome: Outcome): Promise<void> {
  if (!core.getBooleanInput("create-check-run")) return;

  const token = core.getInput("github-token");
  if (!token) {
    core.warning(
      "are-we-good: 'create-check-run' is enabled but 'github-token' was not provided — skipping check run creation.",
    );
    return;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const headSha = process.env.GITHUB_SHA;
  if (!repository || !headSha) {
    core.warning(
      "are-we-good: Missing GITHUB_REPOSITORY/GITHUB_SHA — skipping check run creation.",
    );
    return;
  }

  const name = deriveCheckName(core.getInput("check-name"), process.env);
  const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

  try {
    const response = await fetch(`${apiUrl}/repos/${repository}/check-runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "are-we-good-action",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        head_sha: headSha,
        status: "completed",
        conclusion: outcome.result === "success" ? "success" : "failure",
        output: {
          title: outcome.result === "success" ? "All jobs passed" : "Unacceptable job result(s)",
          summary: outcome.message,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      core.warning(
        `are-we-good: Failed to create check run '${name}' (${response.status}): ${body}`,
      );
      return;
    }

    core.info(`are-we-good: Created check run '${name}'.`);
  } catch (err) {
    core.warning(`are-we-good: Failed to create check run '${name}': ${err}`);
  }
}

/** ─── Entry point ───────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  try {
    notifyUbuntuSlimIfApplicable();

    const outcome = evaluateJobs(
      core.getInput("jobs", { required: true }),
      core.getInput("allowed-to-skip"),
      core.getInput("allowed-to-cancel"),
      core.getInput("allowed-to-fail"),
    );

    // Write step summary (best-effort — a failure here is logged but not fatal).
    if (core.getBooleanInput("summary")) {
      await writeSummary(outcome).catch((err) =>
        core.warning(`are-we-good: Failed to write step summary: ${err}`),
      );
    }

    if (core.isDebug()) {
      logDebugDetails(outcome);
    }

    await maybeCreateCheckRun(outcome).catch((err) =>
      core.warning(`are-we-good: Failed to create check run: ${err}`),
    );

    core.setOutput("result", outcome.result);
    core.setOutput("are-we-good", outcome.result === "success" ? "true" : "false");

    if (outcome.result === "success") {
      core.info(outcome.message);
    } else {
      core.setFailed(outcome.message);
    }

    printFinalBanner(outcome.result);
  } catch (err) {
    core.setFailed(`are-we-good: ${err}`);
    printFinalBanner("failure");
  }
}

void main();
