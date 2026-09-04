/**
 * are-we-good — job outcome evaluation
 *
 * Pure business logic with no side effects. The GitHub Actions runtime
 * (core.getInput / core.setOutput / core.summary) lives in main.ts so this
 * module stays trivially testable without mocks.
 */

import type { WorkflowJob } from "@octokit/webhooks-types";

/** ─── Types ─────────────────────────────────────────────────────────────── */

/** Upstream GitHub workflow-job conclusions (excluding null while in-progress). */
type JobResult = NonNullable<WorkflowJob["conclusion"]>;

const VALID_JOB_RESULTS = [
  "success",
  "failure",
  "cancelled",
  "skipped",
] as const satisfies ReadonlyArray<JobResult>;

/** One entry in the object returned by `toJSON(needs)`. */
interface JobStatus {
  readonly result: JobResult;
}

/**
 * The full `needs` context as serialised by `toJSON(needs)`.
 * Keys are job names; values are their statuses.
 */
type JobsContext = Readonly<Record<string, JobStatus>>;

/**
 * Explains why a job result was accepted or rejected.
 * Used to populate the step summary table and debug log.
 */
export type AcceptanceReason =
  | "success" // job completed successfully
  | "skipped-wildcard" // skipped; all skips allowed (no allowlist set)
  | "skipped-allowlisted" // skipped; this job is in allowed-to-skip
  | "cancelled-allowlisted" // cancelled; this job is in allowed-to-cancel
  | "failure-allowlisted" // failed; this job is in allowed-to-fail
  | "rejected"; // result was not acceptable under any rule

/** Per-job evaluation detail — used for the step summary and debug log. */
export interface JobDetail {
  readonly name: string;
  readonly result: JobResult;
  readonly acceptable: boolean;
  readonly reason: AcceptanceReason;
}

/** What this action reports back to the calling workflow. */
export interface Outcome {
  readonly result: "success" | "failure";
  readonly message: string;
  /** Per-job breakdown, in the same order as the input. */
  readonly details: ReadonlyArray<JobDetail>;
}

/** ─── Runner detection ──────────────────────────────────────────────────── */

/** The subset of `process.env` needed to detect the runner environment. */
export interface RunnerEnv {
  readonly RUNNER_ENVIRONMENT?: string;
  readonly RUNNER_OS?: string;
  readonly ImageOS?: string;
}

/**
 * Detects whether the workflow is running on a GitHub-hosted `ubuntu-latest`
 * (or other stock Ubuntu) runner. There's no direct "ubuntu-latest" signal
 * exposed to actions, so this infers it from `RUNNER_ENVIRONMENT` being
 * "github-hosted" plus the Linux `ImageOS` value GitHub sets on its hosted
 * Ubuntu images (e.g. "ubuntu24", "ubuntu22").
 */
export function isGithubHostedUbuntuRunner(env: RunnerEnv): boolean {
  return (
    env.RUNNER_ENVIRONMENT === "github-hosted" &&
    env.RUNNER_OS === "Linux" &&
    !!env.ImageOS?.startsWith("ubuntu")
  );
}

/** ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Evaluates all jobs and returns a single pass/fail outcome with per-job details.
 *
 * @param jobsJson           Raw JSON string from `toJSON(needs)`.
 * @param allowedToSkipRaw   Comma-separated job names whose `skipped` status is
 *                           acceptable. Empty string → all jobs may be skipped.
 * @param allowedToCancelRaw Comma-separated job names whose `cancelled` status
 *                           is acceptable. Empty string → none allowed.
 * @param allowedToFailRaw   Comma-separated job names whose `failure` status is
 *                           acceptable. Empty string → none allowed.
 * @throws {Error} when `jobsJson` cannot be parsed as a JSON object.
 */
export function evaluateJobs(
  jobsJson: string,
  allowedToSkipRaw: string,
  allowedToCancelRaw: string,
  allowedToFailRaw: string,
): Outcome {
  const jobs = parseJobsContext(jobsJson);

  const allowedToSkip = parseAllowlist(allowedToSkipRaw);
  const allowedToCancel = parseAllowlist(allowedToCancelRaw);
  const allowedToFail = parseAllowlist(allowedToFailRaw);

  const details = Object.entries(jobs).map(([name, { result }]) =>
    evaluateJob(name, result, allowedToSkip, allowedToCancel, allowedToFail),
  );

  const violations = details.filter((d) => !d.acceptable);

  if (violations.length > 0) {
    const list = violations.map((d) => `'${d.name}' was ${d.result}`).join(", ");
    return {
      result: "failure",
      message: `are-we-good: ❌ Unacceptable job result(s): ${list}`,
      details,
    };
  }

  return { result: "success", message: "are-we-good: ✅ All jobs passed.", details };
}

/** ─── Helpers ───────────────────────────────────────────────────────────── */

/**
 * Parses and validates the raw `jobs` JSON input.
 * @throws {Error} when the value is not valid JSON or not a plain object.
 */
function parseJobsContext(raw: string): JobsContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`'jobs' input is not valid JSON: ${cause}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("'jobs' input must be a JSON object mapping job names to their statuses.");
  }

  const jobs = parsed as Record<string, unknown>;
  const normalized: Record<string, JobStatus> = {};

  for (const [name, value] of Object.entries(jobs)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`'jobs.${name}' must be an object with a string 'result' field.`);
    }

    const result = (value as { result?: unknown }).result;
    if (typeof result !== "string" || !isJobResult(result)) {
      throw new Error(`'jobs.${name}.result' must be one of: ${VALID_JOB_RESULTS.join(", ")}.`);
    }

    normalized[name] = { result };
  }

  return normalized;
}

function isJobResult(value: string): value is JobResult {
  return VALID_JOB_RESULTS.includes(value as JobResult);
}

/**
 * Splits a comma-separated allowlist string into a trimmed, non-empty array.
 * Returns an empty array for a blank or all-whitespace input.
 */
export function parseAllowlist(raw: string): ReadonlyArray<string> {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Evaluates a single job against the allowlist rules and returns a detailed result.
 *
 * | result    | acceptable when                                              |
 * |-----------|--------------------------------------------------------------|
 * | success   | always                                                       |
 * | skipped   | allowedToSkip is empty (wildcard) OR includes this job       |
 * | cancelled | allowedToCancel includes this job                            |
 * | failure   | allowedToFail includes this job                              |
 */
function evaluateJob(
  name: string,
  result: JobResult,
  allowedToSkip: ReadonlyArray<string>,
  allowedToCancel: ReadonlyArray<string>,
  allowedToFail: ReadonlyArray<string>,
): JobDetail {
  switch (result) {
    case "success":
      return { name, result, acceptable: true, reason: "success" };

    case "skipped":
      if (allowedToSkip.length === 0)
        return { name, result, acceptable: true, reason: "skipped-wildcard" };
      if (allowedToSkip.includes(name))
        return { name, result, acceptable: true, reason: "skipped-allowlisted" };
      /* falls through */ return { name, result, acceptable: false, reason: "rejected" };

    case "cancelled":
      return allowedToCancel.includes(name)
        ? { name, result, acceptable: true, reason: "cancelled-allowlisted" }
        : { name, result, acceptable: false, reason: "rejected" };

    case "failure":
      return allowedToFail.includes(name)
        ? { name, result, acceptable: true, reason: "failure-allowlisted" }
        : { name, result, acceptable: false, reason: "rejected" };
  }
}
