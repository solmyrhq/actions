"use strict";

// GitHub REST and GraphQL client built on Node's `fetch`, because the actions in
// this repository install no packages.

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
    async get(route) {
      return (await send("GET", `${apiUrl}${route}`)).data;
    },
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

// Returns `value` as a pull request number. Throws unless `value` is a positive
// whole number in decimal digits. Unlike `gh`, it throws on a URL, because a
// URL can name a pull request in another repository.
function pullRequestNumber(value) {
  const text = String(value ?? "").trim();
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number === 0) {
    throw new Error(`Give the pull request as a number, not ${JSON.stringify(text)}.`);
  }
  return number;
}

// Returns a client for the GitHub instance that the job runs on.
function runnerClient(token, fetchImpl = fetch) {
  return client({
    token,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
    graphqlUrl: process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql",
    fetch: fetchImpl,
  });
}

module.exports = { nextLink, client, runnerClient, pullRequestNumber };
