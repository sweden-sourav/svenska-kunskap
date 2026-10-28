#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import net from "node:net";

const requiredPorts = [5001, 3001, 5173];

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function fail(message, hint) {
  console.error(`\nPreflight failed: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

function checkDockerBinary() {
  const r = run("docker", ["--version"]);
  if (r.error || r.status !== 0) {
    fail(
      "Docker CLI is not available.",
      "Install Docker Desktop and ensure `docker` is on your PATH.",
    );
  }
}

function checkDockerDaemon() {
  const r = run("docker", ["info"]);
  if (r.error || r.status !== 0) {
    fail(
      "Docker daemon is not running.",
      "Start Docker Desktop, wait until it is ready, then run `npm run dev:all` again.",
    );
  }
}

function isTranslatorRunning() {
  const r = run("docker", [
    "compose",
    "ps",
    "--services",
    "--status",
    "running",
  ]);
  if (r.error || r.status !== 0) return false;
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .includes("libretranslate");
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function checkPorts() {
  const busy = [];
  for (const port of requiredPorts) {
    // If we cannot bind, something is already listening on that port.
    // This is usually an old dev server/container instance.
    if (!(await canListen(port))) {
      // Port 5001 is fine when the project's translator is already running.
      if (port === 5001 && isTranslatorRunning()) {
        console.log(
          "Port 5001 is already used by running LibreTranslate: reusing it.",
        );
        continue;
      }
      busy.push(port);
    }
  }
  if (busy.length > 0) {
    fail(
      `Required port(s) already in use: ${busy.join(", ")}`,
      `Stop conflicting processes, then retry. Helpful command on macOS/Linux: lsof -nP -iTCP:${busy[0]} -sTCP:LISTEN`,
    );
  }
}

async function main() {
  console.log("Running preflight checks...");
  checkDockerBinary();
  checkDockerDaemon();
  await checkPorts();
  console.log("Preflight passed: Docker is ready and required ports are free.");
}

await main();
