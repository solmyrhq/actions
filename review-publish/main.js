"use strict";

const { input, annotate, info, run } = require("../toolkit/action.js");
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
    headSha,
    directory,
    log: { info, warning: (message) => annotate("warning", message) },
  });
  if (failed) {
    throw new Error("The review was posted, but some of the threads that it nominated were not resolved. The warnings above name them.");
  }
});
