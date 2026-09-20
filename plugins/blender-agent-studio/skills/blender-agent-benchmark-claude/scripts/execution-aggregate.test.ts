import { describe, expect, test } from "bun:test";
import { summarizeExecution } from "./run_benchmark.ts";
import type { AgentTraceSummary } from "./trace.ts";

function trace(over: Partial<AgentTraceSummary> = {}): AgentTraceSummary {
  return {
    events: 0,
    invalidLines: 0,
    completedTurns: 0,
    completedItemsByType: {},
    toolCalls: 0,
    toolFailures: 0,
    errors: 0,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
    resultSubtype: "success",
    permissionDenials: 0,
    durationMs: 0,
    durationApiMs: 0,
    totalCostUsd: 0,
    terminalReason: "completed",
    sawResult: true,
    ...over,
  };
}

// Figures from the validated run on 2026-09-19: in 18, out 334,
// cache read 43,688, cache write 46,879, thinking 144, cost $0.0998148.
const validatedRun = {
  agent: {
    durationMs: 9_728,
    trace: trace({
      toolCalls: 2,
      completedTurns: 3,
      usage: {
        inputTokens: 18,
        cachedInputTokens: 43_688,
        cacheWriteInputTokens: 46_879,
        outputTokens: 334,
        reasoningOutputTokens: 144,
        totalTokens: 352,
      },
      totalCostUsd: 0.0998148,
    }),
  },
};

describe("summarizeExecution", () => {
  test("sums cost and exposes how badly totalTokens understates spend", () => {
    const agg = summarizeExecution([validatedRun, validatedRun]);

    expect(agg.totalCostUsd).toBeCloseTo(0.1996296, 6);
    expect(agg.totalToolCalls).toBe(4);
    expect(agg.totalDurationMs).toBe(19_456);

    // The point of the whole change: totalTokens is 704 across both runs,
    // while the provider actually billed 181,170 input tokens.
    expect(agg.totalTokens).toBe(704);
    expect(agg.totalBilledInputTokens).toBe(181_170);
    expect(agg.totalBilledInputTokens / agg.totalTokens).toBeGreaterThan(250);

    expect(agg.totalCachedInputTokens).toBe(87_376);
    expect(agg.totalCacheWriteInputTokens).toBe(93_758);
    expect(agg.totalThinkingTokens).toBe(288);
  });

  test("reports complete cost coverage when every run returned a cost", () => {
    const agg = summarizeExecution([validatedRun, validatedRun]);
    expect(agg.costCoverage).toEqual({
      runsWithCost: 2,
      runsTotal: 2,
      complete: true,
    });
  });

  test("flags incomplete coverage when a run died before its result event", () => {
    // A harness timeout kills the process, so no result event and no cost.
    // The sum would silently understate; coverage has to say so.
    const killed = {
      agent: {
        durationMs: 2_700_000,
        trace: trace({
          sawResult: false,
          errors: 1,
          terminalReason: null,
          totalCostUsd: 0,
          usage: {
            inputTokens: 900,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 120,
            reasoningOutputTokens: 0,
            totalTokens: 1_020,
          },
        }),
      },
    };
    const agg = summarizeExecution([validatedRun, killed]);

    expect(agg.costCoverage.complete).toBe(false);
    expect(agg.costCoverage.runsWithCost).toBe(1);
    expect(agg.costCoverage.runsTotal).toBe(2);
    // Cost is still the single validated run's, and the caveat explains why.
    expect(agg.totalCostUsd).toBeCloseTo(0.0998148, 6);
    expect(agg.totalErrors).toBe(1);
    expect(agg.costCaveat).toContain("costCoverage.complete is false");
  });

  test("handles an empty run set without dividing by anything", () => {
    const agg = summarizeExecution([]);
    expect(agg.totalCostUsd).toBe(0);
    expect(agg.totalBilledInputTokens).toBe(0);
    expect(agg.costCoverage).toEqual({
      runsWithCost: 0,
      runsTotal: 0,
      complete: true,
    });
  });
});
