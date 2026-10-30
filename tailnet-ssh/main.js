"use strict";

// Joins the tailnet and writes an SSH config for one host over it.

const fs = require("node:fs");
const path = require("node:path");
const { input, setOutput, run, join } = require("../tailnet/runtime.js");
const lib = require("./lib.js");

run(async () => {
  const host = lib.validateHost(input("host"));
  const pin = lib.normaliseFingerprint(input("host-fingerprint"));
  const { dir, tailscale, socket } = await join("tailnet-ssh-");

  const knownHostsCommand = path.join(dir, "known-hosts");
  fs.writeFileSync(knownHostsCommand, lib.knownHostsScript(pin), { mode: 0o700 });
  const config = path.join(dir, "ssh_config");
  fs.writeFileSync(config, lib.sshConfig({ host, tailscale, socket, knownHostsCommand }), { mode: 0o600 });
  setOutput("ssh-config", config);
  console.log(`Joined the tailnet. Connect with: ssh -F "${config}" ${host}`);
});
