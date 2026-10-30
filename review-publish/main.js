"use strict";

const { input, annotate, run } = require("../toolkit/action.js");
const check = require("../review-check/lib.js");
const lib = require("./lib.js");

run(async () => {
  const token = input("token");
  const directory = input("directory");
  const markerName = check.validateMarkerName(input("marker"));
  const headSha = check.validateSha(input("head-sha"));
  const pr = Number(input("pr"));
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error(`pr must be a pull request number: ${JSON.stringify(input("pr"))}`);
  }
  // The publish job runs in the same workflow run as the job that checked the
  // files, so the run ID and attempt rebuild the same marker.
  const marker = check.runMarker(markerName, headSha, process.env.GITHUB_RUN_ID ?? "", process.env.GITHUB_RUN_ATTEMPT ?? "");

  const { failed } = await lib.publish({
    github: lib.client({
      token,
      apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
      graphqlUrl: process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql",
      fetch,
    }),
    repository: process.env.GITHUB_REPOSITORY,
    pr,
    markerName,
    marker,
    directory,
    log: { info: console.log, warning: (message) => annotate("warning", message) },
  });
  if (failed) {
    throw new Error("The review was posted, but some of the threads that it nominated were not resolved. The warnings above name them.");
  }
});
