#!/usr/bin/env node
// asc-payout for Claude Desktop: starts the asc-payout program installed on this computer
// with `asc-payout mcp`, which answers over stdin/stdout. Nothing runs anywhere else.
// If asc-payout is not installed yet, a small stand-in explains how to install it.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const { existsSync, statSync } = require("node:fs");
const { homedir } = require("node:os");
const { delimiter, join } = require("node:path");
const readline = require("node:readline");

const windows = process.platform === "win32";
const exe = windows ? "asc-payout.exe" : "asc-payout";

function isFile(path) {
  try {
    return !!path && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The installed asc-payout: the path set in the extension's settings, the installers' folders, then PATH. */
function findProgram() {
  const configured = (process.env.ASC_PAYOUT_BIN || "").trim();
  if (configured && !configured.includes("${") && isFile(configured)) return configured;
  const home = homedir();
  const known = windows
    ? [
        join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "Programs", "asc-payout", exe),
        join(home, ".local", "bin", exe),
        join(home, "scoop", "shims", exe),
      ]
    : [join(home, ".local", "bin", exe), "/opt/homebrew/bin/asc-payout", "/usr/local/bin/asc-payout", "/home/linuxbrew/.linuxbrew/bin/asc-payout"];
  const onPath = (process.env.PATH || "").split(delimiter).filter(Boolean).map((dir) => join(dir, exe));
  return [...known, ...onPath].find(isFile) || null;
}

/** asc-payout answers MCP from version 1.7.0 on. */
const FIRST_VERSION = [1, 7, 0];

function versionOf(path) {
  try {
    const r = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 15000, windowsHide: true, env: { ...process.env, ASC_PAYOUT_NO_UPDATE_CHECK: "1" } });
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout || "");
    return m ? m.slice(1).map(Number) : null;
  } catch {
    return null;
  }
}

const older = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const program = findProgram();
const version = program ? versionOf(program) : null;
if (program && version && older(version, FIRST_VERSION) < 0) {
  standIn(
    `asc-payout ${version.join(".")} is installed, but this extension needs ${FIRST_VERSION.join(".")} or newer.\n\n` +
      "Update it in a terminal:  asc-payout update\nThen restart Claude Desktop (or turn the asc-payout extension off and on).",
  );
} else if (program) {
  const child = spawn(program, ["mcp"], { stdio: "inherit", windowsHide: true });
  child.on("error", (error) => {
    process.stderr.write(`asc-payout could not start: ${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
} else {
  standIn();
}

/** Not installed (or too old): one tool that tells the person what to do. */
function standIn(reason) {
  const help = reason || [
    "asc-payout is not installed on this computer (or not where the extension looks).",
    "",
    "1. Install it:",
    "   macOS / Linux:  curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash",
    "   Windows (PowerShell):  irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex",
    "2. Set up your App Store Connect account in a terminal:  asc-payout setup",
    "3. Restart Claude Desktop (or turn the asc-payout extension off and on).",
    "",
    "Installed somewhere else? Set its path in the extension's settings (Settings > Extensions > asc-payout).",
    "More: https://github.com/erenacarboga/asc-payout",
  ].join("\n");
  const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id === undefined || m.id === null) return;
    const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
    if (m.method === "initialize") {
      reply({
        protocolVersion: (m.params && m.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "asc-payout", version: "0" },
        instructions: "asc-payout cannot answer yet. Call asc_payout_setup_help and show the user the steps.",
      });
    } else if (m.method === "ping") reply({});
    else if (m.method === "tools/list") {
      reply({
        tools: [
          {
            name: "asc_payout_setup_help",
            description: "asc-payout is not ready on this computer (not installed or too old): returns what to do. Use for any App Store earnings question.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    } else if (m.method === "tools/call") reply({ content: [{ type: "text", text: help }] });
    else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
  });
}
