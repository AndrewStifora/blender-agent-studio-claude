import { describe, expect, test } from "bun:test";
import { buildCodexArgs, pluginPrefix } from "./run_benchmark.ts";
import { resolveModelOptions } from "./model-options.ts";
import { BENCHMARK_TASKS } from "./tasks.ts";
import { resolve } from "node:path";

describe("pluginPrefix", () => {
  test("loads iterative refinement only for the opt-in gauntlet", () => {
    const gauntlet = BENCHMARK_TASKS.find(
      (task) => task.id === "lunar_sample_cell_gauntlet",
    )!;
    const historical = BENCHMARK_TASKS.find(
      (task) => task.id === "winch_drawbridge",
    )!;

    expect(pluginPrefix("skills", gauntlet)).toContain(
      "$blender-agent-studio:blender-iterative-refinement",
    );
    expect(pluginPrefix("skills", historical)).not.toContain(
      "blender-iterative-refinement",
    );
  });

  test("loads animation, rendering, and refinement for the fire lantern", () => {
    const task = BENCHMARK_TASKS.find(
      (item) => item.id === "realistic_fire_lantern_showcase",
    )!;
    const prefix = pluginPrefix("skills", task);
    expect(prefix).toContain("$blender-agent-studio:blender-animation-workflow");
    expect(prefix).toContain("$blender-agent-studio:blender-rendering-workflow");
    expect(prefix).toContain("$blender-agent-studio:blender-iterative-refinement");
  });
});

// PORTED: Claude model profiles and the --effort levels.
describe("benchmark model selection", () => {
  test("pins a model without increasing the comparison effort", () => {
    expect(resolveModelOptions({ profile: "opus" })).toEqual({
      model: "claude-opus-5", reasoning: "medium", modelProfile: "opus",
    });
    expect(resolveModelOptions({ profile: "opus", reasoning: "high" }).reasoning).toBe("high");
  });

  test("keeps the configured default and every profile available", () => {
    expect(resolveModelOptions({})).toEqual({ model: undefined, reasoning: "medium", modelProfile: null });
    const expected: Record<string, string> = {
      opus: "claude-opus-5",
      sonnet: "claude-sonnet-5",
      fable: "claude-fable-5-1",
      haiku: "claude-haiku-4-5-20251001",
    };
    for (const [profile, model] of Object.entries(expected)) {
      expect(resolveModelOptions({ profile }).model).toBe(model);
    }
    // An explicit id is honoured, so a model not yet in the profile table can
    // still be benchmarked.
    expect(resolveModelOptions({ model: "custom-model", reasoning: "low" }).model).toBe("custom-model");
  });

  test("rejects incompatible settings instead of silently changing a comparison", () => {
    // Codex accepted none/minimal/ultra; Claude's --effort does not.
    for (const reasoning of ["none", "minimal", "ultra", "typo"]) {
      expect(() => resolveModelOptions({ profile: "opus", reasoning })).toThrow("Unsupported effort");
      expect(() => resolveModelOptions({ model: "claude-opus-5", reasoning })).toThrow("Unsupported effort");
    }
    // Prototype keys must not resolve as profiles.
    expect(() => resolveModelOptions({ profile: "toString" })).toThrow("Unsupported model profile");
    expect(() => resolveModelOptions({ profile: "opus", model: "claude-sonnet-5" })).toThrow("conflicting");
    // Agreeing profile and model is fine, and xhigh/max are valid.
    expect(resolveModelOptions({ profile: "opus", model: "claude-opus-5", reasoning: "xhigh" }).reasoning).toBe("xhigh");
    expect(resolveModelOptions({ profile: "haiku", reasoning: "max" }).reasoning).toBe("max");
  });
});

// PORTED to the Claude Code CLI. Assertions target the replacement flags:
// --bare for isolation, --effort for reasoning, --permission-mode for the
// sandbox, and a fresh --session-id in place of --ephemeral.
describe("benchmark execution isolation", () => {
  const base = {
    cwd: "C:/bench/example", prompt: "build the asset", reasoning: "medium",
    timeoutMs: 1000, bypassApprovals: false, skillRootPinned: false,
    model: "claude-opus-5",
  };

  test("isolates a labeled baseline and passes the model through", () => {
    const options = { ...base, mode: "baseline" as const, conditionLabel: "opus-before" };
    const args = buildCodexArgs(options);
    expect(args).toContain("-p");
    expect(args).toContain("--bare");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("medium");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--verbose");
    // The condition label must never reach the agent.
    expect(args).not.toContain("opus-before");
    // Codex ended with "-" for stdin; Claude's -p reads piped stdin directly.
    expect(args).not.toContain("-");
    expect(args[args.indexOf("--add-dir") + 1]).toBe("C:/bench/example");
  });

  test("--bare covers every isolation flag the Codex build spelled out", () => {
    for (const mode of ["baseline", "skills"] as const) {
      const args = buildCodexArgs({ ...base, mode });
      expect(args).toContain("--bare");
      expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
      // None of the Codex-specific config plumbing should survive.
      expect(args).not.toContain("--ignore-user-config");
      expect(args.some((v) => v.startsWith("skills.config=["))).toBe(false);
      expect(args).not.toContain("project_doc_max_bytes=0");
    }
  });

  test("gives every run a distinct session id, replacing --ephemeral", () => {
    const first = buildCodexArgs({ ...base, mode: "baseline" });
    const second = buildCodexArgs({ ...base, mode: "baseline" });
    const idOf = (args: string[]) => args[args.indexOf("--session-id") + 1];
    expect(idOf(first)).toMatch(/^[0-9a-f-]{36}$/);
    expect(idOf(first)).not.toBe(idOf(second));
  });

  test("does not expand permissions when selecting a model", () => {
    const args = buildCodexArgs({ ...base, mode: "baseline" });
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(
      buildCodexArgs({ ...base, mode: "baseline", bypassApprovals: true }),
    ).toContain("--dangerously-skip-permissions");
  });

  test("pinned MCP mode wires exactly the plugin's own server", () => {
    // Inside the plugin, ../../.. is the plugin root and mcp/server.ts exists,
    // so this pins the real server. --strict-mcp-config is the point: it
    // ignores every other MCP configuration, which the Codex original's
    // additive -c overrides did not.
    const skillRoot = resolve(import.meta.dir, "../../..");
    const args = buildCodexArgs({
      ...base, mode: "skills_mcp", skillRootPinned: true, skillRoot,
    });
    expect(args).toContain("--strict-mcp-config");
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    expect(Object.keys(config.mcpServers)).toEqual(["bas_benchmark"]);
    expect(config.mcpServers.bas_benchmark.command).toBe("bun");
    expect(config.mcpServers.bas_benchmark.args[0]).toContain("mcp");
    expect(config.mcpServers.bas_benchmark.args[0]).toContain("server.ts");

    // A missing skill root must fail loudly, not run without MCP.
    expect(() => buildCodexArgs({ ...base, mode: "skills_mcp" })).toThrow(
      "pinned skillRoot",
    );
    // A root with no server must fail loudly too.
    expect(() =>
      buildCodexArgs({
        ...base, mode: "skills_mcp", skillRootPinned: true,
        skillRoot: resolve(import.meta.dir, "no-such-root"),
      }),
    ).toThrow("Pinned MCP server is missing");
    // Non-MCP modes must never carry MCP configuration.
    expect(
      buildCodexArgs({ ...base, mode: "skills", skillRootPinned: true, skillRoot }),
    ).not.toContain("--mcp-config");
  });
});
