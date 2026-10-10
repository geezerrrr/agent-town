#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkgPath = resolve(root, "package.json");

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  \x1b[36m\x1b[1mAgent Town\x1b[0m  Pixel-style AI Agent collaboration community

  Usage
    $ agent-town [options]

  Options
    --port     <number>  Port to listen on             (default: 3000)
    --gateway  <url>     Gateway WebSocket URL          (default: ws://127.0.0.1:18789/)
    --provider <name>    Agent provider: openclaw|auggie (default: openclaw)
    -v, --version        Show version
    -h, --help           Show this help message

  Examples
    $ agent-town
    $ agent-town --port 8080
    $ agent-town --gateway ws://192.168.1.100:18789/
    $ agent-town --provider auggie
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  console.log(pkg.version);
  process.exit(0);
}

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const port = getArg("--port");
const gateway = getArg("--gateway");
const provider = getArg("--provider");

if (port) process.env.PORT = port;
if (gateway) process.env.GATEWAY_URL = gateway;
if (provider) {
  process.env.AGENT_PROVIDER = provider;
  process.env.NEXT_PUBLIC_AGENT_PROVIDER = provider;
}
process.env.NODE_ENV = "production";

const serverPath = resolve(root, ".next", "standalone", "server.prod.mjs");
await import(pathToFileURL(serverPath).href);
