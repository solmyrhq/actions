"use strict";

const { input, annotate, info, run } = require("../toolkit/action.js");
const { runnerClient, pullRequestNumber } = require("../toolkit/github.js");
const check = require("../review-check/lib.js");
const lib = require("./lib.js");

run(async () => {
  const token = input("token");
  const directory = input("directory");
  const markerName = check.validateMarkerName(input("marker"));
  const headSha = check.validateSha(input("head-sha"));
  const pr = pullRequestNumber(input("pr"));

  const { failed } = await lib.publish({
    github: runnerClient(token),
    repository: process.env.GITHUB_REPOSITORY,
    pr,
    markerName,
    headSha,
    directory,
    log: { info, warning: (message) => annotate("warning", message) },
  });
  if (failed) {
    throw new Error("The review was posted, but some of the threads that it nominated were not resolved. The warnings above name them.");
  }
});
