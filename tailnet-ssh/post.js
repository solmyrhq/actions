"use strict";

// Logs the node out, stops tailscaled and deletes the directory main.js
// created. Failures only warn: the runner's job-completed hook kills a leftover
// tailscaled, and Tailscale then removes the offline ephemeral node.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function warn(message) {
  console.log(`::warning::${message.replace(/\r?\n/g, "%0A")}`);
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

async function post() {
  const dir = process.env.STATE_dir;
  if (!dir) {
    return;
  }
  const socket = path.join(dir, "tailscaled.sock");
  if (fs.existsSync(socket)) {
    try {
      execFileSync(path.join(dir, "tailscale"), [`--socket=${socket}`, "logout"], { stdio: "inherit", timeout: 20000 });
    } catch (error) {
      warn(`tailscale logout failed (${error.message}). Tailscale will remove the ephemeral node after it goes offline.`);
    }
  }
  const pid = Number.parseInt(process.env.STATE_pid ?? "", 10);
  if (Number.isInteger(pid) && pid > 0) {
    await stop(pid);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

post().catch((error) => warn(`Cleanup failed: ${error.message}`));
