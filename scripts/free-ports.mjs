#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const defaultPorts = [3001, 5173];
const parsedPorts = process.argv
  .slice(2)
  .map((v) => Number(v))
  .filter((n) => Number.isInteger(n) && n > 0);
const ports = parsedPorts.length > 0 ? parsedPorts : defaultPorts;

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

function pidsListeningOn(port) {
  const r = run("lsof", ["-nP", "-iTCP:" + String(port), "-sTCP:LISTEN", "-t"]);
  if (r.error) return [];
  if (r.status !== 0) return [];
  return [
    ...new Set(
      r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait is fine for this tiny CLI utility
  }
}

let hadAny = false;
let failed = false;

for (const port of ports) {
  const pids = pidsListeningOn(port);
  if (pids.length === 0) {
    console.log(`Port ${port} is already free.`);
    continue;
  }

  hadAny = true;
  console.log(
    `Port ${port} is in use by PID(s): ${pids.join(", ")}. Sending SIGTERM...`,
  );
  for (const pid of pids) killPid(pid, "SIGTERM");

  sleepMs(600);

  const stillThere = pidsListeningOn(port);
  if (stillThere.length > 0) {
    console.log(
      `Port ${port} still busy after SIGTERM (PID(s): ${stillThere.join(", ")}). Sending SIGKILL...`,
    );
    for (const pid of stillThere) killPid(pid, "SIGKILL");
    sleepMs(300);
  }

  const finalCheck = pidsListeningOn(port);
  if (finalCheck.length > 0) {
    console.error(
      `Could not free port ${port}. Still used by PID(s): ${finalCheck.join(", ")}.`,
    );
    failed = true;
  } else {
    console.log(`Port ${port} is now free.`);
  }
}

if (!hadAny) {
  console.log("Nothing to kill: target ports were already free.");
}

if (failed) {
  console.error("Force cleanup did not fully succeed.");
  process.exit(1);
}

console.log("Force cleanup finished successfully.");
