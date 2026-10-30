"use strict";

const { input, setOutput, info, run } = require("../toolkit/action.js");
const { runnerClient, pullRequestNumber } = require("../toolkit/github.js");
const lib = require("./lib.js");

run(async () => {
  const token = input("token");
  const pr = pullRequestNumber(input("pr"));
  const artifactPrefix = lib.validateArtifactPrefix(input("artifact-prefix"));
  const repository = process.env.GITHUB_REPOSITORY;

  const result = await lib.prepare({
    github: runnerClient(token),
    repository,
    pr,
    artifactPrefix,
    runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
  });
  if (!result.review) {
    info(`Pull request #${pr} is not reviewed: ${result.reason}.`);
    setOutput("review", "false");
    return;
  }
  setOutput("review", "true");
  setOutput("pr-number", String(result.prNumber));
  setOutput("head-sha", result.headSha);
  setOutput("base-sha", result.baseSha);
  setOutput("artifact", result.artifact);
  info(`Reviewing pull request #${result.prNumber} at ${result.headSha}.`);
});
