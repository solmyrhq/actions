"use strict";

const { input, setOutput, hyphenatedName, currentRun, info, run } = require("../toolkit/action.js");
const { runnerClient, pullRequestNumber } = require("../toolkit/github.js");
const lib = require("./lib.js");

run(async () => {
  const token = input("token");
  const pr = pullRequestNumber(input("pr"));
  const artifactPrefix = hyphenatedName("artifact-prefix", input("artifact-prefix"), "codex-review");
  const repository = process.env.GITHUB_REPOSITORY;

  const result = await lib.prepare({
    github: runnerClient(token),
    repository,
    pr,
    artifactPrefix,
    run: currentRun(),
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
