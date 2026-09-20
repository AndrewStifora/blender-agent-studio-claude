/**
 * End-to-end port validation.
 *
 * Spawns a real `claude` run using the harness's own buildClaudeArgs(), writes
 * the event stream exactly as run_benchmark.ts does, then parses it with the
 * ported summarizeAgentEvents(). Proves the tool_use / tool_result / result
 * mapping against live output rather than against the schema alone.
 *
 *   bun validate-port.ts [--model haiku] [--effort low] [--no-bare]
 */

import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeArgs } from "./scripts/agent-cli.ts";
import { summarizeAgentEvents } from "./scripts/trace.ts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const cwd = mkdtempSync(join(tmpdir(), "bas-port-"));
const PROMPT =
  "Create a file named ok.txt in the current directory containing exactly " +
  "the word ok. Then read it back to confirm. Do nothing else.";

let args = buildClaudeArgs({
  cwd,
  prompt: PROMPT,
  mode: "baseline",
  model: arg("--model", "claude-haiku-4-5-20251001"),
  reasoning: arg("--effort", "low"),
  timeoutMs: 300_000,
  bypassApprovals: true,
});

// --bare forces ANTHROPIC_API_KEY / apiKeyHelper auth and never reads OAuth or
// the keychain. Allow dropping it so the parser can still be validated on a
// machine authenticated interactively.
if (process.argv.includes("--no-bare")) {
  args = args.filter((a, i) =>
    a !== "--bare" &&
    !(a === "--setting-sources") &&
    !(args[i - 1] === "--setting-sources"),
  );
}

console.log("cwd :", cwd);
console.log("args:", ["claude", ...args].join(" "));

const eventsPath = join(cwd, "agent-events.jsonl");
const stderrPath = join(cwd, "agent-stderr.log");
await Promise.all([
  writeFile(eventsPath, "", { flag: "wx" }),
  writeFile(stderrPath, "", { flag: "wx" }),
]);

const started = performance.now();
const proc = Bun.spawn(["claude", ...args], {
  cwd,
  stdin: "pipe",
  stdout: Bun.file(eventsPath),
  stderr: Bun.file(stderrPath),
  windowsHide: true,
});
proc.stdin.write(PROMPT);
proc.stdin.end();
const exitCode = await proc.exited;
const wallMs = Math.round(performance.now() - started);

const stdout = await readFile(eventsPath, "utf8");
const stderr = await readFile(stderrPath, "utf8");
const summary = summarizeAgentEvents(stdout);

console.log("\n--- process ---");
console.log("exitCode:", exitCode, " wallMs:", wallMs);
if (stderr.trim()) console.log("stderr  :", stderr.trim().slice(0, 600));

console.log("\n--- raw event types seen ---");
const seen = new Map<string, number>();
for (const line of stdout.split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const e = JSON.parse(line) as Record<string, unknown>;
    const key = `${e.type}${e.subtype ? "/" + e.subtype : ""}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  } catch {
    seen.set("<invalid>", (seen.get("<invalid>") ?? 0) + 1);
  }
}
for (const [key, count] of [...seen].sort()) console.log(`  ${key}: ${count}`);

console.log("\n--- parsed summary ---");
console.log(JSON.stringify(summary, null, 2));

console.log("\n--- assertions ---");
const checks: Array<[string, boolean]> = [
  ["saw a result event", summary.sawResult],
  ["no invalid JSON lines", summary.invalidLines === 0],
  ["counted >=1 tool call", summary.toolCalls >= 1],
  ["tallied tool_result blocks", (summary.completedItemsByType["tool_result"] ?? 0) >= 1],
  ["recorded input tokens", summary.usage.inputTokens > 0],
  ["recorded output tokens", summary.usage.outputTokens > 0],
  ["recorded turns", summary.completedTurns >= 1],
  ["recorded a duration", summary.durationMs > 0],
];
let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log(`\n${ok ? "PORT VALIDATED" : "PORT VALIDATION INCOMPLETE"}`);
process.exit(ok ? 0 : 1);
