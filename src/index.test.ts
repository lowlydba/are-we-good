import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateJobs, isGithubHostedUbuntuRunner } from "./index.ts";

/** Builds the JSON string that `toJSON(needs)` produces in a calling workflow. */
function makeJobs(map: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { result: v }])),
  );
}

describe("evaluateJobs", () => {
  it("all jobs success → success", () => {
    const { result } = evaluateJobs(makeJobs({ build: "success", test: "success" }), "", "", "");
    assert.equal(result, "success");
  });

  it("skipped job, no allowed-to-skip set → success (wildcard default)", () => {
    const { result } = evaluateJobs(makeJobs({ build: "success", lint: "skipped" }), "", "", "");
    assert.equal(result, "success");
  });

  it("skipped job, not in explicit allowed-to-skip list → failure", () => {
    const { result, message } = evaluateJobs(
      makeJobs({ build: "success", lint: "skipped" }),
      "build", // only 'build' is in the list, not 'lint'
      "",
      "",
    );
    assert.equal(result, "failure");
    assert.ok(message.includes("lint"));
  });

  it("cancelled job, not in allowed-to-cancel → failure", () => {
    const { result, message } = evaluateJobs(makeJobs({ build: "cancelled" }), "", "", "");
    assert.equal(result, "failure");
    assert.ok(message.includes("build"));
  });

  it("cancelled job, in allowed-to-cancel → success", () => {
    const { result } = evaluateJobs(makeJobs({ build: "cancelled" }), "", "build", "");
    assert.equal(result, "success");
  });

  it("failed job, not in allowed-to-fail → failure", () => {
    const { result, message } = evaluateJobs(makeJobs({ lint: "failure" }), "", "", "");
    assert.equal(result, "failure");
    assert.ok(message.includes("lint"));
  });

  it("failed job, in allowed-to-fail → success", () => {
    const { result } = evaluateJobs(makeJobs({ lint: "failure" }), "", "", "lint");
    assert.equal(result, "success");
  });

  it("mixed: allowed failure + unallowed cancellation → failure naming only the cancellation", () => {
    const { result, message } = evaluateJobs(
      makeJobs({ lint: "failure", deploy: "cancelled" }),
      "",
      "", // deploy cancelled is NOT allowed
      "lint", // lint failure IS allowed
    );
    assert.equal(result, "failure");
    assert.ok(message.includes("deploy"));
    assert.ok(!message.includes("lint"));
  });

  it("all jobs skipped → success", () => {
    const { result } = evaluateJobs(
      makeJobs({ build: "skipped", test: "skipped", lint: "skipped" }),
      "",
      "",
      "",
    );
    assert.equal(result, "success");
  });

  it("invalid JSON input → throws", () => {
    assert.throws(() => evaluateJobs("not-json", "", "", ""));
  });

  it("valid JSON that is not an object (array) → throws", () => {
    assert.throws(() => evaluateJobs("[]", "", "", ""), /must be a JSON object/);
  });

  it("job entry that is not an object → throws", () => {
    assert.throws(
      () => evaluateJobs('{"build":"success"}', "", "", ""),
      /jobs\.build.*must be an object/,
    );
  });

  it("job entry with missing result field → throws", () => {
    assert.throws(
      () => evaluateJobs('{"build":{}}', "", "", ""),
      /jobs\.build\.result.*must be one of/,
    );
  });

  it("job entry with unsupported result value → throws", () => {
    assert.throws(
      () => evaluateJobs('{"build":{"result":"timed_out"}}', "", "", ""),
      /jobs\.build\.result.*must be one of/,
    );
  });

  // ─── Per-job details ───────────────────────────────────────────────────────

  it("details length matches number of input jobs", () => {
    const { details } = evaluateJobs(
      makeJobs({ build: "success", test: "success", lint: "skipped" }),
      "",
      "",
      "",
    );
    assert.equal(details.length, 3);
  });

  it("success job has reason 'success'", () => {
    const { details } = evaluateJobs(makeJobs({ build: "success" }), "", "", "");
    assert.equal(details[0].reason, "success");
    assert.equal(details[0].acceptable, true);
  });

  it("skipped job with no allowlist has reason 'skipped-wildcard'", () => {
    const { details } = evaluateJobs(makeJobs({ lint: "skipped" }), "", "", "");
    assert.equal(details[0].reason, "skipped-wildcard");
    assert.equal(details[0].acceptable, true);
  });

  it("skipped job explicitly allowlisted has reason 'skipped-allowlisted'", () => {
    const { details } = evaluateJobs(makeJobs({ lint: "skipped" }), "lint", "", "");
    assert.equal(details[0].reason, "skipped-allowlisted");
    assert.equal(details[0].acceptable, true);
  });

  it("cancelled job in allowed-to-cancel has reason 'cancelled-allowlisted'", () => {
    const { details } = evaluateJobs(makeJobs({ deploy: "cancelled" }), "", "deploy", "");
    assert.equal(details[0].reason, "cancelled-allowlisted");
    assert.equal(details[0].acceptable, true);
  });

  it("failed job in allowed-to-fail has reason 'failure-allowlisted'", () => {
    const { details } = evaluateJobs(makeJobs({ lint: "failure" }), "", "", "lint");
    assert.equal(details[0].reason, "failure-allowlisted");
    assert.equal(details[0].acceptable, true);
  });

  it("unacceptable job has reason 'rejected' and acceptable false", () => {
    const { details } = evaluateJobs(makeJobs({ build: "failure" }), "", "", "");
    assert.equal(details[0].reason, "rejected");
    assert.equal(details[0].acceptable, false);
  });
});

describe("isGithubHostedUbuntuRunner", () => {
  it("github-hosted Linux ubuntu-latest image → true", () => {
    assert.equal(
      isGithubHostedUbuntuRunner({
        RUNNER_ENVIRONMENT: "github-hosted",
        RUNNER_OS: "Linux",
        ImageOS: "ubuntu24",
      }),
      true,
    );
  });

  it("self-hosted runner → false", () => {
    assert.equal(
      isGithubHostedUbuntuRunner({
        RUNNER_ENVIRONMENT: "self-hosted",
        RUNNER_OS: "Linux",
        ImageOS: "ubuntu24",
      }),
      false,
    );
  });

  it("github-hosted non-Linux runner → false", () => {
    assert.equal(
      isGithubHostedUbuntuRunner({
        RUNNER_ENVIRONMENT: "github-hosted",
        RUNNER_OS: "Windows",
        ImageOS: "win22",
      }),
      false,
    );
  });

  it("missing ImageOS → false", () => {
    assert.equal(
      isGithubHostedUbuntuRunner({
        RUNNER_ENVIRONMENT: "github-hosted",
        RUNNER_OS: "Linux",
      }),
      false,
    );
  });
});
