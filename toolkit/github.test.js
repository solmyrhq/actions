"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const github = require("./github.js");

const respond = (body, { status = 200, link } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(link === undefined ? {} : { link }),
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const make = (fetch) => github.client({ token: "t", apiUrl: "https://api.test", graphqlUrl: "https://api.test/graphql", fetch });

test("the client follows the next link until the last page", async () => {
  const pages = {
    "https://api.test/r?per_page=100": respond([1, 2], { link: '<https://api.test/r?page=2>; rel="next", <https://api.test/r?page=2>; rel="last"' }),
    "https://api.test/r?page=2": respond([3], { link: '<https://api.test/r?per_page=100>; rel="first"' }),
  };
  assert.deepEqual(await make(async (url) => pages[url]).paginate("/r"), [1, 2, 3]);
});

test("a GraphQL error in a 200 response is raised", async () => {
  await assert.rejects(make(async () => respond({ errors: [{ message: "nope" }] })).graphql("query { x }", {}), /GraphQL error: nope/);
});

test("a GET returns the parsed body, and a failed one names the route and the status", async () => {
  assert.deepEqual(await make(async () => respond({ number: 7 })).get("/repos/o/r/pulls/7"), { number: 7 });
  await assert.rejects(make(async () => respond("Not Found", { status: 404 })).get("/repos/o/r/pulls/7"), /GET https:\/\/api\.test\/repos\/o\/r\/pulls\/7 failed: HTTP 404/);
});

test("a pull request number is a positive whole number in decimal digits, and anything else is refused", () => {
  assert.equal(github.pullRequestNumber("11"), 11);
  assert.equal(github.pullRequestNumber(" 7 "), 7);
  assert.equal(github.pullRequestNumber("07"), 7);
  for (const bad of ["", "0", "00", "-1", "1.5", "1e3", "0x1f", "9007199254740993", "https://github.com/solmyrhq/actions/pull/11", "11 #", undefined]) {
    assert.throws(() => github.pullRequestNumber(bad), /as a number/, String(bad));
  }
});

test("the runner's client calls the job's GitHub instance, or github.com when the job names none", async () => {
  const saved = { api: process.env.GITHUB_API_URL, graphql: process.env.GITHUB_GRAPHQL_URL };
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return respond({ data: {} });
  };
  try {
    process.env.GITHUB_API_URL = "https://ghe.test/api/v3";
    process.env.GITHUB_GRAPHQL_URL = "https://ghe.test/api/graphql";
    await github.runnerClient("t", fetch).get("/r");
    await github.runnerClient("t", fetch).graphql("query { x }", {});
    delete process.env.GITHUB_API_URL;
    delete process.env.GITHUB_GRAPHQL_URL;
    await github.runnerClient("t", fetch).get("/r");
    await github.runnerClient("t", fetch).graphql("query { x }", {});
  } finally {
    restore("GITHUB_API_URL", saved.api);
    restore("GITHUB_GRAPHQL_URL", saved.graphql);
  }
  assert.deepEqual(urls, ["https://ghe.test/api/v3/r", "https://ghe.test/api/graphql", "https://api.github.com/r", "https://api.github.com/graphql"]);
});
