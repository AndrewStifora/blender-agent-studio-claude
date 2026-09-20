/**
 * Claude Code stream-json event parser.
 *
 * Same exported name and same AgentTraceSummary field set as the Codex
 * original, so score.ts / verified_score.ts / compare_runs.ts are unchanged.
 * Extra fields are additive.
 *
 * Schema mapping from Codex `--json` to Claude `--output-format stream-json`:
 *
 *   turn.completed                     ->  result
 *   usage.input_tokens                 ->  usage.input_tokens            (same)
 *   usage.output_tokens                ->  usage.output_tokens           (same)
 *   usage.cached_input_tokens          ->  usage.cache_read_input_tokens
 *   usage.cache_write_input_tokens     ->  usage.cache_creation_input_tokens
 *   usage.reasoning_output_tokens      ->  usage.output_tokens_details.thinking_tokens
 *                                          (observed live as thinking_tokens;
 *                                           reasoning_tokens kept as fallback)
 *   item.completed + item.type         ->  assistant events, message.content[].type
 *   item.status==failed / exit_code!=0 ->  user events, tool_result.is_error
 *   item.type=="error"                 ->  result.is_error / subtype error_*
 *
 * Claude additionally reports num_turns, permission_denials, duration_ms,
 * duration_api_ms and total_cost_usd on the result event. The Codex parser had
 * to infer those; they are surfaced here because the skill's own benchmark
 * contract asks for execution failures, recovery turns and time.
 */

export type AgentTraceSummary = {
  events: number;
  invalidLines: number;
  completedTurns: number;
  completedItemsByType: Record<string, number>;
  toolCalls: number;
  toolFailures: number;
  errors: number;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  };
  // --- additive, Claude-specific
  resultSubtype: string | null;
  permissionDenials: number;
  durationMs: number;
  durationApiMs: number;
  totalCostUsd: number;
  /**
   * Observed live: an expired-OAuth failure returns subtype "success" with
   * is_error true and terminal_reason "api_error". Do not trust subtype alone.
   */
  terminalReason: string | null;
  sawResult: boolean;
};

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Thinking-token count.
 *
 * Observed live as output_tokens_details.thinking_tokens. reasoning_tokens is
 * accepted as a fallback because that is the name the Codex original used and
 * the field may be spelled either way across versions.
 */
function thinkingTokens(usage: Record<string, unknown>): number {
  const details = asRecord(usage.output_tokens_details);
  return numeric(details.thinking_tokens) || numeric(details.reasoning_tokens);
}

function contentBlocks(event: Record<string, unknown>): Record<string, unknown>[] {
  const message = asRecord(event.message);
  const content = message.content;
  return Array.isArray(content) ? content.map(asRecord) : [];
}

export function summarizeAgentEvents(stdout: string): AgentTraceSummary {
  const summary: AgentTraceSummary = {
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
    resultSubtype: null,
    permissionDenials: 0,
    durationMs: 0,
    durationApiMs: 0,
    totalCostUsd: 0,
    terminalReason: null,
    sawResult: false,
  };

  // Claude reports cumulative usage once, on the result event. If the run is
  // killed by the harness timeout there is no result event, so per-assistant
  // usage is accumulated as a fallback rather than reporting zero.
  const fallback = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };

  const tally = (key: string) => {
    summary.completedItemsByType[key] =
      (summary.completedItemsByType[key] ?? 0) + 1;
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      summary.invalidLines += 1;
      continue;
    }
    summary.events += 1;

    if (event.type === "assistant") {
      const usage = asRecord(asRecord(event.message).usage);
      fallback.input += numeric(usage.input_tokens);
      fallback.output += numeric(usage.output_tokens);
      fallback.cacheRead += numeric(usage.cache_read_input_tokens);
      fallback.cacheWrite += numeric(usage.cache_creation_input_tokens);
      fallback.reasoning += thinkingTokens(usage);
      for (const block of contentBlocks(event)) {
        const type = typeof block.type === "string" ? block.type : "unknown";
        if (type === "tool_use") {
          summary.toolCalls += 1;
          const name = typeof block.name === "string" ? block.name : "unknown";
          tally(`tool_use:${name}`);
        } else {
          tally(type);
        }
      }
      continue;
    }

    if (event.type === "user") {
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_result") continue;
        tally("tool_result");
        if (block.is_error === true) {
          summary.toolFailures += 1;
        }
      }
      continue;
    }

    if (event.type === "result") {
      summary.sawResult = true;
      summary.resultSubtype =
        typeof event.subtype === "string" ? event.subtype : null;
      summary.completedTurns = numeric(event.num_turns);
      summary.durationMs = numeric(event.duration_ms);
      summary.durationApiMs = numeric(event.duration_api_ms);
      summary.totalCostUsd = numeric(event.total_cost_usd);
      summary.terminalReason =
        typeof event.terminal_reason === "string" ? event.terminal_reason : null;
      if (Array.isArray(event.permission_denials)) {
        summary.permissionDenials = event.permission_denials.length;
      }
      if (
        event.is_error === true ||
        (summary.resultSubtype ?? "").startsWith("error") ||
        summary.terminalReason === "api_error"
      ) {
        summary.errors += 1;
      }
      const usage = asRecord(event.usage);
      summary.usage.inputTokens = numeric(usage.input_tokens);
      summary.usage.outputTokens = numeric(usage.output_tokens);
      summary.usage.cachedInputTokens = numeric(usage.cache_read_input_tokens);
      summary.usage.cacheWriteInputTokens = numeric(
        usage.cache_creation_input_tokens,
      );
      summary.usage.reasoningOutputTokens = thinkingTokens(usage);
      continue;
    }

    if (typeof event.type === "string") {
      tally(`event:${event.type}`);
    }
  }

  if (!summary.sawResult) {
    // Timed out or crashed before the result event.
    summary.usage.inputTokens = fallback.input;
    summary.usage.outputTokens = fallback.output;
    summary.usage.cachedInputTokens = fallback.cacheRead;
    summary.usage.cacheWriteInputTokens = fallback.cacheWrite;
    summary.usage.reasoningOutputTokens = fallback.reasoning;
    summary.errors += 1;
  }

  summary.usage.totalTokens =
    summary.usage.inputTokens + summary.usage.outputTokens;
  return summary;
}
