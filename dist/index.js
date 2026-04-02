/**
 * are-we-good — job outcome evaluation
 *
 * Pure business logic with no side effects. The GitHub Actions runtime
 * (core.getInput / core.setOutput) lives in main.ts so this module
 * stays trivially testable without mocks.
 */
// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Evaluates all jobs and returns a single pass/fail outcome.
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
export function evaluateJobs(jobsJson, allowedToSkipRaw, allowedToCancelRaw, allowedToFailRaw) {
    const jobs = parseJobsContext(jobsJson);
    const allowedToSkip = parseAllowlist(allowedToSkipRaw);
    const allowedToCancel = parseAllowlist(allowedToCancelRaw);
    const allowedToFail = parseAllowlist(allowedToFailRaw);
    const violations = Object.entries(jobs)
        .filter(([name, { result }]) => !isAcceptable(name, result, allowedToSkip, allowedToCancel, allowedToFail))
        .map(([name, { result }]) => `'${name}' was ${result}`);
    if (violations.length > 0) {
        return {
            result: "failure",
            message: `are-we-good: ❌ Unacceptable job result(s): ${violations.join(", ")}`,
        };
    }
    return { result: "success", message: "are-we-good: ✅ All jobs passed." };
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Parses and validates the raw `jobs` JSON input.
 * @throws {Error} when the value is not valid JSON or not a plain object.
 */
function parseJobsContext(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (cause) {
        throw new Error(`'jobs' input is not valid JSON: ${cause}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("'jobs' input must be a JSON object mapping job names to their statuses.");
    }
    return parsed;
}
/**
 * Splits a comma-separated allowlist string into a trimmed, non-empty array.
 * Returns an empty array for a blank or all-whitespace input.
 */
export function parseAllowlist(raw) {
    if (!raw.trim())
        return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
/**
 * Determines whether a single job result is acceptable under the given rules.
 *
 * | result    | acceptable when                                              |
 * |-----------|--------------------------------------------------------------|
 * | success   | always                                                       |
 * | skipped   | allowedToSkip is empty (wildcard) OR includes this job       |
 * | cancelled | allowedToCancel includes this job                            |
 * | failure   | allowedToFail includes this job                              |
 */
function isAcceptable(jobName, result, allowedToSkip, allowedToCancel, allowedToFail) {
    switch (result) {
        case "success":
            return true;
        case "skipped":
            // Empty allowedToSkip acts as a wildcard — all jobs may be skipped by default.
            return allowedToSkip.length === 0 || allowedToSkip.includes(jobName);
        case "cancelled":
            return allowedToCancel.includes(jobName);
        case "failure":
            return allowedToFail.includes(jobName);
    }
}
