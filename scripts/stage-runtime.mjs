#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const wuxianpiRoot = args.get("--wuxianpi");
const serviceManager = args.get("--service-manager");
const node = args.get("--node");
const deepseekHarness = args.get("--deepseek-harness");
const output = resolve(args.get("--output") || join(repoRoot, "bundled", "runtime"));
const platform = args.get("--platform") || process.platform;
const arch = args.get("--arch") || process.arch;

if (!wuxianpiRoot || !serviceManager || !node) {
  throw new Error("Usage: stage-runtime.mjs --wuxianpi DIR --service-manager FILE --node FILE [--deepseek-harness DIR] [--output DIR] [--platform win32] [--arch x64]");
}

const required = [
  join(wuxianpiRoot, "wuxianpi-normal", "runtime", "dist", "index.js"),
  join(wuxianpiRoot, "wuxianpi-normal", "web", "index.html"),
  join(wuxianpiRoot, "wuxianpi-repair", "runtime", "dist", "index.js"),
  join(wuxianpiRoot, "wuxianpi-repair", "web", "index.html"),
  serviceManager,
  node,
];
if (deepseekHarness) {
  required.push(
    join(deepseekHarness, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
  );
}
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing runtime input: ${file}`);
}

mkdirSync(output, { recursive: true });
for (const name of ["wuxianpi-normal", "wuxianpi-repair", "service-manager", "node", "deepseek-harness"]) {
  rmSync(join(output, name), { recursive: true, force: true });
}

for (const profile of ["wuxianpi-normal", "wuxianpi-repair"]) {
  cpSync(join(wuxianpiRoot, profile), join(output, profile), { recursive: true });
}
mkdirSync(join(output, "service-manager"), { recursive: true });
cpSync(serviceManager, join(output, "service-manager", platform === "win32" ? "service-manager.exe" : "service-manager"));
const nodeDir = join(output, "node", `${platform}-${arch}`);
mkdirSync(nodeDir, { recursive: true });
cpSync(node, join(nodeDir, platform === "win32" ? "node.exe" : basename(node)));
if (deepseekHarness) {
  cpSync(deepseekHarness, join(output, "deepseek-harness"), { recursive: true, dereference: true });
}

console.log(`OpenHouse runtime staged at ${output}`);
