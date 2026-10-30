"use strict";

// Joins the tailnet without root for the rest of a job, and leaves it in the
// post step. tailscale/github-action runs tailscaled with sudo, which the
// self-hosted runner user does not have.

const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { input, saveState, setOutput, annotate, run } = require("../toolkit/action.js");
const lib = require("./lib.js");

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

// Reads the inputs that every tailnet action shares, starts tailscaled with
// `extraDaemonArgs` and brings the node up. The caller validates its own
// inputs first, so that a bad input fails before anything is downloaded.
async function join(prefix, extraDaemonArgs = []) {
  const oauthSecret = input("oauth-secret");
  const tags = lib.validateTags(input("tags"));
  const version = lib.validateVersion(input("version"));
  const sha256 = lib.validateSha256(input("sha256"));
  const arch = lib.tailscaleArch(process.env.RUNNER_ARCH ?? "");

  const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, prefix));
  fs.chmodSync(dir, 0o700);
  saveState("dir", dir);

  const tarball = path.join(dir, "tailscale.tgz");
  await download(`https://pkgs.tailscale.com/stable/tailscale_${version}_${arch}.tgz`, sha256, tarball);
  execFileSync("tar", ["-xzf", tarball, "-C", dir, "--strip-components=1"], { env: childEnv });
  const tailscale = path.join(dir, "tailscale");
  const socket = path.join(dir, "tailscaled.sock");
  const log = path.join(dir, "tailscaled.log");

  const pid = await startDaemon(path.join(dir, "tailscaled"), lib.daemonArgs({ dir, socket, extra: extraDaemonArgs }), log);
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
  return { dir, tailscale, socket, log };
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stop(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 20 && isRunning(pid); attempt++) {
    await sleep(250);
  }
  if (isRunning(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
}

// Logs the node out, stops tailscaled and deletes the directory join()
// created. Failures only warn: the runner's job-completed hook kills a leftover
// tailscaled, and Tailscale then removes the offline ephemeral node.
async function leave() {
  const dir = process.env.STATE_dir;
  if (!dir) {
    return;
  }
  const socket = path.join(dir, "tailscaled.sock");
  if (fs.existsSync(socket)) {
    try {
      execFileSync(path.join(dir, "tailscale"), [`--socket=${socket}`, "logout"], { stdio: "inherit", timeout: 20000 });
    } catch (error) {
      annotate("warning", `tailscale logout failed (${error.message}). Tailscale will remove the ephemeral node after it goes offline.`);
    }
  }
  const pid = Number.parseInt(process.env.STATE_pid ?? "", 10);
  if (Number.isInteger(pid) && pid > 0) {
    await stop(pid);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function runLeave() {
  leave().catch((error) => annotate("warning", `Cleanup failed: ${error.message}`));
}

module.exports = { input, setOutput, run, join, runLeave };
