/**
 * GitHub Actions entry point.
 *
 * Reads action inputs, delegates all logic to evaluateJobs(), writes the step
 * summary (optional), emits debug logs when the runner is in debug mode, and
 * reports the final result via @actions/core.
 */

import * as core from "@actions/core";
import { evaluateJobs, type Outcome, type JobDetail } from "./index.ts";

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
    return [`\`${d.name}\``, `${emoji} ${d.result}`, status];
  });

  await core.summary
    .addHeading("are-we-good", 3)
    .addTable([
      [
        { data: "Job", header: true },
        { data: "Result", header: true },
        { data: "Status", header: true },
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

/** ─── Entry point ───────────────────────────────────────────────────────── */

try {
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

  core.setOutput("result", outcome.result);
  core.setOutput("are-we-good", outcome.result === "success" ? "true" : "false");

  if (outcome.result === "success") {
    core.info(outcome.message);
  } else {
    core.setFailed(outcome.message);
  }
} catch (err) {
  core.setFailed(`are-we-good: ${err}`);
}
