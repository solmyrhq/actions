"use strict";

// Posts the review files that review-check passed, and resolves the threads
// that the review nominated. The model chose which threads to nominate, so
// each one is checked again here: only a thread that this review opened on
// this pull request is resolved.

const fs = require("node:fs");
const path = require("node:path");

// GraphQL names the GITHUB_TOKEN's author `github-actions`; REST names it
// `github-actions[bot]`.
const BOT = { graphql: "github-actions", rest: "github-actions[bot]" };

function nextLink(header) {
  for (const part of (header ?? "").split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part);
    if (match) return match[1];
  }
  return undefined;
}

function client({ token, apiUrl, graphqlUrl, fetch }) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function send(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${url} failed: HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return { response, data: text === "" ? undefined : JSON.parse(text) };
  }

  return {
    async post(route, body) {
      return (await send("POST", `${apiUrl}${route}`, body)).data;
    },
    async paginate(route) {
      const items = [];
      let url = `${apiUrl}${route}${route.includes("?") ? "&" : "?"}per_page=100`;
      while (url !== undefined) {
        const { response, data } = await send("GET", url);
        items.push(...data);
        url = nextLink(response.headers.get("link"));
      }
      return items;
    },
    async graphql(query, variables) {
      const { data } = await send("POST", graphqlUrl, { query, variables });
      if (data.errors?.length) {
        throw new Error(`GraphQL error: ${data.errors.map((error) => error.message).join("; ")}`);
      }
      return data.data;
    },
  };
}

const THREAD_QUERY = `
query($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      isResolved
      pullRequest { number repository { nameWithOwner } }
      comments(first: 1) { nodes { author { login } body } }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

// Returns why a thread must not be resolved, or undefined if it may be. Node
// IDs are global: with a token that can read other repositories, the query can
// return a thread on another repository's pull request with the same number.
function refusal(node, repository, pr, markerName) {
  const first = node?.comments?.nodes?.[0];
  const where = node?.pullRequest;
  if (node?.isResolved !== false) return `it is not an unresolved review thread (isResolved=${node?.isResolved})`;
  if (where?.repository?.nameWithOwner !== repository || where?.number !== pr) {
    return `it is on ${where?.repository?.nameWithOwner}#${where?.number}`;
  }
  if (first?.author?.login !== BOT.graphql) return `its first comment is from ${first?.author?.login ?? "nobody"}`;
  if (!(first.body ?? "").startsWith(`<!-- ${markerName}:`)) return `its first comment is not from the ${markerName} review`;
  return undefined;
}

// Returns the marker that review-check wrote on the summary's first line, and
// throws unless it is a `markerName` marker for `headSha`. The marker holds the
// review job's run attempt, which is lower than this job's when only the
// publish job is re-run.
function summaryMarker(summary, markerName, headSha) {
  const first = summary.split("\n", 1)[0];
  const expected = new RegExp(`^<!-- ${markerName}:${headSha}:\\d+:\\d+ -->$`);
  if (!expected.test(first)) {
    throw new Error(`The summary does not start with a ${markerName} marker for ${headSha}. Was it checked by review-check?`);
  }
  return first;
}

async function publish({ github, repository, pr, markerName, headSha, directory, log }) {
  let summary = fs.readFileSync(path.join(directory, "summary.md"), "utf8");
  const marker = summaryMarker(summary, markerName, headSha);
  const comments = fs.readdirSync(directory).filter((name) => /^comment-.*\.json$/.test(name)).sort();
  let failed = false;

  // When only the publish job is re-run, the marker is the same, and an earlier
  // attempt may already have posted some of these comments.
  const ours = (posted) => posted.user?.login === BOT.rest && (posted.body ?? "").startsWith(marker);
  const place = (comment) => JSON.stringify([comment.path, comment.line, comment.side, comment.body]);
  const inline = new Set((await github.paginate(`/repos/${repository}/pulls/${pr}/comments`)).filter(ours).map(place));
  const summaryPosted = (await github.paginate(`/repos/${repository}/issues/${pr}/comments`)).some(ours);

  for (const name of comments) {
    const comment = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    if (inline.has(place(comment))) {
      log.info(`Already posted ${name}`);
      continue;
    }
    try {
      await github.post(`/repos/${repository}/pulls/${pr}/comments`, comment);
    } catch (error) {
      log.warning(`Could not post ${name}; adding it to the summary. ${error.message}`);
      summary += `\n\n### Inline comment that could not be posted\n\n\`${comment.path}\` line ${comment.line}\n\n${comment.body.replace(marker, "").trimStart()}`;
    }
  }

  if (summaryPosted) {
    log.info("Already posted the summary");
  } else {
    await github.post(`/repos/${repository}/issues/${pr}/comments`, { body: summary });
  }

  const { threads } = JSON.parse(fs.readFileSync(path.join(directory, "resolve.json"), "utf8"));
  for (const { id, reason } of threads) {
    let node;
    try {
      node = (await github.graphql(THREAD_QUERY, { threadId: id })).node;
    } catch (error) {
      log.warning(`Could not read thread ${id}: ${error.message}`);
      failed = true;
      continue;
    }
    if (node?.isResolved === true) {
      log.info(`Already resolved ${id}`);
      continue;
    }
    const why = refusal(node, repository, pr, markerName);
    if (why !== undefined) {
      log.warning(`Refusing to resolve ${id}: ${why}.`);
      failed = true;
      continue;
    }
    try {
      await github.graphql(RESOLVE_MUTATION, { threadId: id });
      log.info(`Resolved ${id}: ${reason}`);
    } catch (error) {
      log.warning(`Could not resolve ${id}: ${error.message}`);
      failed = true;
    }
  }

  if (!(await github.paginate(`/repos/${repository}/issues/${pr}/comments`)).some(ours)) {
    throw new Error(`No summary comment on pull request #${pr} starts with the review's marker ${marker}.`);
  }
  return { failed };
}

module.exports = { nextLink, client, refusal, summaryMarker, publish };
