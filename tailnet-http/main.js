"use strict";

// Joins the tailnet and serves an HTTP proxy into it on loopback. The proxy has
// no authentication: while the job runs, any process on the runner can use it.

const fs = require("node:fs");
const { setOutput, run, join } = require("../tailnet/runtime.js");
const lib = require("../tailnet/lib.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForProxyAddress(log) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const address = lib.httpProxyAddress(fs.readFileSync(log, "utf8"));
    if (address !== undefined) {
      return address;
    }
    await sleep(250);
  }
  throw new Error(`tailscaled did not report the address of its HTTP proxy. Its log:\n${fs.readFileSync(log, "utf8")}`);
}

run(async () => {
  // tailscaled binds port 0 itself. A port chosen here first could be taken by
  // another process before tailscaled binds it.
  const { log } = await join("tailnet-http-", ["--outbound-http-proxy-listen=127.0.0.1:0"]);
  const address = await waitForProxyAddress(log);
  setOutput("http-proxy", `http://${address}`);
  console.log(`Joined the tailnet. Send requests through http://${address}.`);
});
