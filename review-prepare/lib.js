"use strict";

// Returns why the job must not review the pull request, or undefined if it must.
function skipReason(pull, repository) {
  if (pull.state !== "open") return "it is closed";
  if (pull.draft === true) return "it is a draft";
  // `head.repo` is null if the fork was deleted.
  if (pull.head?.repo?.full_name !== repository) return "it is from a fork";
  return undefined;
}

// Returns `{ review: false, reason }` if the job must not review pull request
// `pr`. Otherwise returns `review: true` with the commits and the artifact name
// for the job's later steps and the publish job. `run` comes from
// `currentRun()`.
async function prepare({ github, repository, pr, artifactPrefix, run }) {
  const pull = await github.get(`/repos/${repository}/pulls/${pr}`);
  const reason = skipReason(pull, repository);
  if (reason !== undefined) {
    return { review: false, reason };
  }
  return {
    review: true,
    prNumber: pull.number,
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    // The publish job must read this name from the review job's outputs: a
    // re-run of only the publish job has a higher run attempt than the attempt
    // that uploaded the artifact.
    artifact: `${artifactPrefix}-${run.id}-${run.attempt}`,
  };
}

module.exports = { skipReason, prepare };
