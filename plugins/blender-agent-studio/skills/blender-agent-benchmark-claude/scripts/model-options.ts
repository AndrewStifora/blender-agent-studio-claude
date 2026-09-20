/**
 * Claude model profiles for the benchmark harness.
 *
 * Exact model ids on purpose, never aliases. `--model opus` resolves to
 * whatever is current, which silently breaks a benchmark the moment a new
 * model ships; a pinned id keeps two runs comparable.
 *
 * Effort maps to the CLI's --effort flag, which replaced the Codex original's
 * `-c model_reasoning_effort="..."`.
 */
const PROFILES = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  fable: "claude-fable-5-1",
  haiku: "claude-haiku-4-5-20251001",
} as const;

/**
 * Levels accepted by `claude --effort`. Whether every model honours every
 * level is not verified here; the harness records the requested value in the
 * run manifest so a comparison can be checked after the fact.
 */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function resolveModelOptions(options: {
  profile?: string;
  model?: string;
  reasoning?: string;
}) {
  if (options.profile && !Object.hasOwn(PROFILES, options.profile)) {
    throw new Error(
      `Unsupported model profile: ${options.profile}. Use ${Object.keys(PROFILES).join(", ")}.`,
    );
  }
  const profileModel = options.profile
    ? PROFILES[options.profile as keyof typeof PROFILES]
    : undefined;
  if (profileModel && options.model && options.model !== profileModel) {
    throw new Error(
      `--profile ${options.profile} selects ${profileModel}; conflicting --model ${options.model}.`,
    );
  }
  const model = options.model ?? profileModel;
  // Keep effort equal across comparison profiles and preserve the prior default.
  const reasoning = options.reasoning ?? "medium";
  if (!EFFORTS.includes(reasoning as (typeof EFFORTS)[number])) {
    throw new Error(
      `Unsupported effort ${reasoning}. Use ${EFFORTS.join(", ")}.`,
    );
  }
  return { model, reasoning, modelProfile: options.profile ?? null };
}

export { PROFILES as CLAUDE_MODEL_PROFILES, EFFORTS as CLAUDE_EFFORTS };
