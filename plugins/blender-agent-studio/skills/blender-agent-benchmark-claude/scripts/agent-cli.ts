/**
 * Claude Code CLI adapter for the benchmark harness.
 *
 * Replaces buildCodexArgs() and the Codex-specific halves of pinned-mcp.ts.
 * Keeps the same contract: one isolated, non-interactive agent run per task,
 * prompt on stdin, newline-delimited JSON events on stdout.
 *
 * Flag mapping from the Codex original:
 *
 *   codex exec ... -                     ->  claude -p            (stdin prompt)
 *   --json                               ->  --output-format stream-json --verbose
 *   -c model_reasoning_effort="high"     ->  --effort high
 *   --model M                            ->  --model M            (same flag)
 *   --sandbox danger-full-access         ->  --permission-mode bypassPermissions
 *   --dangerously-bypass-approvals...    ->  --dangerously-skip-permissions
 *   -C <cwd>                             ->  dropped; Bun.spawn({cwd}) sets it
 *   --skip-git-repo-check                ->  dropped; Claude needs no git repo
 *   --ephemeral                          ->  fresh --session-id per run
 *   --ignore-user-config --ignore-rules
 *     --disable plugins --disable memories
 *     -c project_doc_max_bytes=0
 *     -c skills.config=[...enabled=false] ->  --bare  (single flag)
 *   mcp_servers.* via five -c pairs      ->  --mcp-config <json> --strict-mcp-config
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type AgentRunOptions = {
  cwd: string;
  prompt: string;
  mode: "baseline" | "skills" | "skills_mcp";
  model?: string;
  reasoning: string;
  timeoutMs: number;
  bypassApprovals: boolean;
  skillRoot?: string;
};

/**
 * Condition isolation.
 *
 * The Codex original enumerated every SKILL.md under the host's skills
 * directories and disabled each by path, which needed a guard because the
 * generated argument exceeded the Windows command-line budget. `--bare` is
 * one flag and covers more: it skips hooks, LSP, plugin sync, auto-memory,
 * background prefetches and CLAUDE.md auto-discovery.
 *
 * Trade-off worth stating: --bare is blunter. It cannot leave some host skills
 * enabled while disabling others, and it forces ANTHROPIC_API_KEY or
 * apiKeyHelper auth (OAuth and keychain are never read). For a benchmark that
 * wants a bare agent, both are features.
 */
export function isolatedAgentArgs(): string[] {
  return ["--bare", "--setting-sources", ""];
}

/** Pinned MCP server, written as a --mcp-config JSON string. */
export function pinnedMcpArgs(root: string): string[] {
  const resolved = resolve(root);
  const server = join(resolved, "mcp/server.ts");
  if (!existsSync(server)) {
    throw new Error(`Pinned MCP server is missing: ${server}`);
  }
  const config = {
    mcpServers: {
      bas_benchmark: {
        command: "bun",
        args: [server],
        cwd: resolved,
      },
    },
  };
  // --strict-mcp-config ignores every other MCP configuration, which is
  // stronger isolation than the Codex original's additive -c overrides.
  return ["--mcp-config", JSON.stringify(config), "--strict-mcp-config"];
}

export function buildClaudeArgs(options: AgentRunOptions): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--effort",
    options.reasoning,
    // A fresh session id per run is the --ephemeral equivalent: nothing is
    // continued or resumed, so no prior turn can leak across conditions.
    "--session-id",
    randomUUID(),
  ];
  if (options.bypassApprovals) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", "bypassPermissions");
  }
  args.push(...isolatedAgentArgs());
  if (options.mode === "skills_mcp") {
    if (!options.skillRoot) {
      throw new Error("MCP benchmarks require a pinned skillRoot");
    }
    args.push(...pinnedMcpArgs(options.skillRoot));
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  // The task directory must be writable by the agent. Under --bare, CLAUDE.md
  // auto-discovery is off, so this grants access without importing context.
  args.push("--add-dir", options.cwd);
  return args;
}

/** Unchanged from the original: agent-independent source hashing. */
export function sourceFingerprint(root: string): string {
  const hash = createHash("sha256");
  const excluded = new Set([
    "node_modules",
    "target",
    ".git",
    ".tmp",
    "__pycache__",
  ]);
  function visit(directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (excluded.has(entry.name)) continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        visit(join(directory, entry.name), relative + "/");
      } else if (entry.isFile()) {
        hash.update(relative + "\0");
        hash.update(readFileSync(join(directory, entry.name)));
        hash.update("\0");
      }
    }
  }
  visit(root);
  return hash.digest("hex");
}

/**
 * MCP preflight. Agent-independent by nature: it speaks MCP to the server
 * directly rather than through the agent, so nothing here needed porting.
 *
 * The SDK is imported lazily. A static import made every module that touches
 * the arg builder fail to load when @modelcontextprotocol/sdk is absent, which
 * it is until `bun install` runs — and skills_mcp mode cannot run here anyway,
 * because the plugin's MCP server was never ported.
 */
export async function preflightPinnedMcp(root: string) {
  pinnedMcpArgs(root);
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const client = new Client({ name: "bas-benchmark-preflight", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: "bun",
        args: [join(resolve(root), "mcp/server.ts")],
        cwd: resolve(root),
        stderr: "pipe",
      }),
    );
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    if (!tools.includes("blender_inspect_asset")) {
      throw new Error("Pinned MCP is missing blender_inspect_asset");
    }
    return {
      serverPath: join(resolve(root), "mcp/server.ts"),
      version: client.getServerVersion(),
      tools,
    };
  } finally {
    await client.close();
  }
}
