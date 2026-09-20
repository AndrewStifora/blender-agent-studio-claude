import { describe, expect, test } from "bun:test";
import { summarizeAgentEvents } from "./trace.ts";

// Event shapes below match a real `claude -p --output-format stream-json
// --verbose` capture: system/init, assistant (text and tool_use blocks),
// user (tool_result blocks), then a single result event carrying cumulative
// usage, num_turns, duration and cost.
const lines = (...items: unknown[]) =>
  items.map((item) => JSON.stringify(item)).join("\n");

describe("summarizeAgentEvents (Claude stream-json)", () => {
  test("counts tool calls, tool failures and cumulative usage", () => {
    const summary = summarizeAgentEvents(
      [
        lines(
          { type: "system", subtype: "init", session_id: "s1" },
          {
            type: "assistant",
            message: {
              content: [
                { type: "text", text: "building" },
                { type: "tool_use", id: "t1", name: "Bash", input: {} },
                { type: "tool_use", id: "t2", name: "Write", input: {} },
              ],
              usage: { input_tokens: 10, output_tokens: 4 },
            },
          },
          {
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "t1", is_error: false },
                { type: "tool_result", tool_use_id: "t2", is_error: true },
              ],
            },
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            num_turns: 3,
            duration_ms: 42_000,
            duration_api_ms: 31_000,
            total_cost_usd: 0.1234,
            permission_denials: [{ tool_name: "Bash" }],
            usage: {
              input_tokens: 120,
              output_tokens: 45,
              cache_read_input_tokens: 900,
              cache_creation_input_tokens: 80,
              output_tokens_details: { thinking_tokens: 17 },
            },
          },
        ),
        "{ not json",
      ].join("\n"),
    );

    expect(summary.events).toBe(4);
    expect(summary.invalidLines).toBe(1);
    expect(summary.completedTurns).toBe(3);
    expect(summary.toolCalls).toBe(2);
    expect(summary.toolFailures).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.sawResult).toBe(true);
    expect(summary.resultSubtype).toBe("success");
    expect(summary.permissionDenials).toBe(1);
    expect(summary.durationMs).toBe(42_000);
    expect(summary.durationApiMs).toBe(31_000);
    expect(summary.totalCostUsd).toBeCloseTo(0.1234);

    // Usage is assigned from the result event, not accumulated, because
    // Claude reports it cumulatively there.
    expect(summary.usage.inputTokens).toBe(120);
    expect(summary.usage.outputTokens).toBe(45);
    expect(summary.usage.cachedInputTokens).toBe(900);
    expect(summary.usage.cacheWriteInputTokens).toBe(80);
    expect(summary.usage.reasoningOutputTokens).toBe(17);
    expect(summary.usage.totalTokens).toBe(165);

    // Tool calls are tallied by tool name, which the Codex item types could
    // not express.
    expect(summary.completedItemsByType["tool_use:Bash"]).toBe(1);
    expect(summary.completedItemsByType["tool_use:Write"]).toBe(1);
    expect(summary.completedItemsByType["tool_result"]).toBe(2);
    expect(summary.completedItemsByType["text"]).toBe(1);
    expect(summary.terminalReason).toBeNull();
  });

  test("falls back to per-message usage when the run is killed", () => {
    // A harness timeout kills the process before any result event, which would
    // otherwise report zero tokens for a run that consumed plenty.
    const summary = summarizeAgentEvents(
      lines(
        { type: "system", subtype: "init" },
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
            usage: {
              input_tokens: 55,
              output_tokens: 7,
              cache_read_input_tokens: 12,
              cache_creation_input_tokens: 3,
            },
          },
        },
      ),
    );

    expect(summary.sawResult).toBe(false);
    expect(summary.usage.inputTokens).toBe(55);
    expect(summary.usage.outputTokens).toBe(7);
    expect(summary.usage.cachedInputTokens).toBe(12);
    expect(summary.usage.cacheWriteInputTokens).toBe(3);
    expect(summary.usage.totalTokens).toBe(62);
    // A missing result event is itself an error condition.
    expect(summary.errors).toBe(1);
    expect(summary.toolCalls).toBe(1);
  });

  test("treats terminal_reason api_error as an error even when subtype says success", () => {
    // Observed live on an expired OAuth session.
    const summary = summarizeAgentEvents(
      lines({
        type: "result",
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        num_turns: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
    expect(summary.errors).toBe(1);
    expect(summary.terminalReason).toBe("api_error");
  });

  test("records an error result subtype", () => {
    const summary = summarizeAgentEvents(
      lines({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: 12,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    expect(summary.errors).toBe(1);
    expect(summary.resultSubtype).toBe("error_max_turns");
    expect(summary.completedTurns).toBe(12);
  });
});
