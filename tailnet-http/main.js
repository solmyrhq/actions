"use strict";

// Joins the tailnet and serves an HTTP proxy into it on loopback. Only a
// process that is given the proxy reaches the tailnet.

const fs = require("node:fs");
const net = require("node:net");
const { setOutput, run, join } = require("../tailnet/runtime.js");
const lib = require("../tailnet/lib.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

run(async () => {
  const port = await freePort();
  const listen = lib.httpProxyListen(port);
  const { log, pid } = await join("tailnet-http-", [`--outbound-http-proxy-listen=${listen}`]);
  // freePort() releases the port before tailscaled binds it, so another
  // process can take it in between. A process that answers on the port is not
  // proof; a listening socket that tailscaled holds is.
  if (!lib.listensOnLoopback(pid, port)) {
    throw new Error(`tailscaled is not listening on ${listen}. Another process may have taken the port. Its log:\n${fs.readFileSync(log, "utf8")}`);
  }
  setOutput("http-proxy", `http://${listen}`);
  console.log(`Joined the tailnet. Send requests through http://${listen}.`);
});
