"use strict";

// Joins the tailnet without root and writes an SSH config for one host over it.
// tailscale/github-action runs tailscaled with sudo, which the self-hosted
// runner user does not have.

const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib.js");

function input(name) {
  const value = (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  if (value === "") {
    throw new Error(`Input '${name}' is required.`);
  }
  return value;
}

function appendCommandFile(variable, name, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Cannot write '${name}' to ${variable}: the value contains a line break.`);
  }
  fs.appendFileSync(process.env[variable], `${name}=${value}\n`);
}

const saveState = (name, value) => appendCommandFile("GITHUB_STATE", name, value);
const setOutput = (name, value) => appendCommandFile("GITHUB_OUTPUT", name, value);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const childEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" };

function startDaemon(command, args, log) {
  return new Promise((resolve, reject) => {
    const daemon = spawn(command, args, {
      detached: true,
      env: childEnv,
      stdio: ["ignore", fs.openSync(log, "a"), fs.openSync(log, "a")],
    });
    daemon.once("error", reject);
    daemon.once("spawn", () => {
      daemon.unref();
      resolve(daemon.pid);
    });
  });
}

async function download(url, sha256, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed: HTTP ${response.status}.`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash("sha256").update(body).digest("hex");
  if (actual !== sha256) {
    throw new Error(`SHA-256 mismatch for ${url}: expected ${sha256}, got ${actual}.`);
  }
  fs.writeFileSync(destination, body);
}

function backendState(tailscale, socket) {
  try {
    return JSON.parse(execFileSync(tailscale, [`--socket=${socket}`, "status", "--json"], { encoding: "utf8", env: childEnv })).BackendState;
  } catch (error) {
    // `tailscale status` exits non-zero while logged out but still prints the
    // status, so a running daemon can land here.
    try {
      return JSON.parse(error.stdout ?? "").BackendState;
    } catch {
      return undefined;
    }
  }
}

async function waitForDaemon(tailscale, socket, log) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (backendState(tailscale, socket) !== undefined) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`tailscaled did not start within 30 seconds. Its log:\n${fs.readFileSync(log, "utf8")}`);
}

async function main() {
  const oauthSecret = input("oauth-secret");
  const tags = lib.validateTags(input("tags"));
  const version = lib.validateVersion(input("version"));
  const sha256 = lib.validateSha256(input("sha256"));
  const host = lib.validateHost(input("host"));
  const pin = lib.normaliseFingerprint(input("host-fingerprint"));
  const arch = lib.tailscaleArch(process.env.RUNNER_ARCH ?? "");

  const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, "tailnet-ssh-"));
  fs.chmodSync(dir, 0o700);
  saveState("dir", dir);

  const tarball = path.join(dir, "tailscale.tgz");
  await download(`https://pkgs.tailscale.com/stable/tailscale_${version}_${arch}.tgz`, sha256, tarball);
  execFileSync("tar", ["-xzf", tarball, "-C", dir, "--strip-components=1"], { env: childEnv });
  const tailscale = path.join(dir, "tailscale");
  const socket = path.join(dir, "tailscaled.sock");
  const log = path.join(dir, "tailscaled.log");

  const pid = await startDaemon(
    path.join(dir, "tailscaled"),
    ["--tun=userspace-networking", "--state=mem:", `--statedir=${path.join(dir, "state")}`, `--socket=${socket}`, "--port=0"],
    log,
  );
  saveState("pid", String(pid));
  await waitForDaemon(tailscale, socket, log);

  const authKey = path.join(dir, "auth-key");
  fs.writeFileSync(authKey, `${oauthSecret}?ephemeral=true&preauthorized=true`, { mode: 0o600 });
  try {
    execFileSync(
      tailscale,
      [
        `--socket=${socket}`,
        "up",
        `--auth-key=file:${authKey}`,
        `--advertise-tags=${tags}`,
        `--hostname=${lib.nodeHostname(
          process.env.GITHUB_REPOSITORY ?? "",
          process.env.GITHUB_RUN_ID ?? "0",
          process.env.GITHUB_RUN_ATTEMPT ?? "1",
          crypto.randomBytes(3).toString("hex"),
        )}`,
        "--timeout=2m",
      ],
      { stdio: "inherit", env: childEnv },
    );
  } finally {
    fs.rmSync(authKey, { force: true });
  }

  const knownHostsCommand = path.join(dir, "known-hosts");
  fs.writeFileSync(knownHostsCommand, lib.knownHostsScript(pin), { mode: 0o700 });
  const config = path.join(dir, "ssh_config");
  fs.writeFileSync(config, lib.sshConfig({ host, tailscale, socket, knownHostsCommand }), { mode: 0o600 });
  setOutput("ssh-config", config);
  console.log(`Joined the tailnet. Connect with: ssh -F "${config}" ${host}`);
}

main().catch((error) => {
  console.log(`::error::${error.message.replace(/\r?\n/g, "%0A")}`);
  process.exitCode = 1;
});
