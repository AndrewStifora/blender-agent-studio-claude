/**
 * Claude Code adapter for the visual judge in compare_runs.ts.
 *
 * THIS IS THE ONE LOSSY PART OF THE PORT. The Codex original relied on three
 * flags with no Claude CLI equivalent:
 *
 *   --output-schema <file>      API-level structured-output enforcement
 *   --output-last-message <f>   writes the final message to a file
 *   --image <path> (repeatable) attaches images to the request
 *   --sandbox read-only         read-only filesystem
 *
 * Compensation, and what it costs:
 *
 *   --output-schema   -> the schema is embedded in the prompt and the reply is
 *                        parsed and validated in TypeScript afterwards. The
 *                        model is asked for conforming JSON rather than being
 *                        constrained to it, so a malformed reply is possible;
 *                        one retry with a stricter instruction is issued before
 *                        giving up. Strictly weaker than the original.
 *   --output-last-message -> `--output-format json` returns the final message
 *                        in `.result`; this module writes judge-result.json
 *                        itself, so the rest of compare_runs.ts is unchanged.
 *   --image           -> absolute image paths are listed in the prompt and the
 *                        agent is told to open each with its Read tool, which
 *                        renders images. Equivalent in effect, one hop longer.
 *   --sandbox read-only -> `--allowedTools "Read Glob"`, an allowlist, so no
 *                        write or execute tool is available at all.
 *
 * Judging is the part of a benchmark that most needs to be trustworthy, so
 * this difference is recorded in the run manifest by compare_runs.ts rather
 * than hidden.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type JudgeInvocation = {
  cwd: string;
  images: string[];
  prompt: string;
  schemaPath: string;
  model: string;
  reasoning: string;
};

/** Pull the first balanced JSON object out of a possibly chatty reply. */
export function extractJsonObject(text: string): string | null {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i += 1) {
    const ch = unfenced[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return unfenced.slice(start, i + 1);
    }
  }
  return null;
}

/** Shape check standing in for the schema the CLI can no longer enforce. */
export function validateJudgeShape(value: unknown): string[] {
  const problems: string[] = [];
  const v = (value ?? {}) as Record<string, unknown>;
  if (!["A", "B", "tie"].includes(v.winner as string)) {
    problems.push(`winner must be "A" | "B" | "tie", got ${JSON.stringify(v.winner)}`);
  }
  if (typeof v.confidence !== "number" || !Number.isFinite(v.confidence)) {
    problems.push("confidence must be a finite number");
  }
  const scores = (v.scores ?? {}) as Record<string, unknown>;
  for (const side of ["A", "B"]) {
    if (typeof scores[side] !== "object" || scores[side] === null) {
      problems.push(`scores.${side} must be an object`);
    }
  }
  if (!Array.isArray(v.criterionResults)) {
    problems.push("criterionResults must be an array");
  }
  return problems;
}

function buildArgs(options: JudgeInvocation): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    options.model,
    "--effort",
    options.reasoning,
    "--bare",
    "--setting-sources",
    "",
    // Allowlist only. No Bash, Write or Edit exists for this run, which is
    // what --sandbox read-only bought in the original.
    "--allowedTools",
    "Read Glob",
    "--add-dir",
    options.cwd,
  ];
}

function composePrompt(
  options: JudgeInvocation,
  schema: string,
  strict: boolean,
): string {
  const images = options.images
    .map((path, index) => `  ${index + 1}. ${path}`)
    .join("\n");
  const preamble = [
    "Open every image below with your Read tool before judging. Do not judge",
    "an image you have not opened.",
    "",
    "Images:",
    images,
    "",
  ].join("\n");
  const tail = [
    "",
    "Reply with a single JSON object and nothing else: no prose, no code",
    "fence, no commentary. It must validate against this JSON Schema:",
    "",
    schema,
  ].join("\n");
  const insist = strict
    ? "\n\nYour previous reply was not valid JSON matching the schema. Output only the JSON object."
    : "";
  return `${preamble}${options.prompt}${tail}${insist}`;
}

async function invoke(
  options: JudgeInvocation,
  schema: string,
  strict: boolean,
): Promise<{ text: string; stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["claude", ...buildArgs(options)], {
    cwd: options.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  proc.stdin.write(composePrompt(options, schema, strict));
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let text = stdout;
  try {
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof envelope.result === "string") text = envelope.result;
  } catch {
    // Not the json envelope; fall back to raw stdout.
  }
  return { text, stdout, stderr, exitCode };
}

export async function runClaudeJudge<T>(options: JudgeInvocation): Promise<{
  result: T;
  stdout: string;
  stderr: string;
  exitCode: number;
  attempts: number;
}> {
  const schema = await readFile(options.schemaPath, "utf8");
  const outputPath = join(options.cwd, "judge-result.json");
  let last = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { text, stdout, stderr, exitCode } = await invoke(
      options,
      schema,
      attempt > 1,
    );
    last = `exit=${exitCode} stderr=${stderr.slice(0, 500)}`;
    const candidate = extractJsonObject(text);
    if (candidate) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate);
      } catch (error) {
        last = `unparseable JSON on attempt ${attempt}: ${String(error)}`;
        continue;
      }
      const problems = validateJudgeShape(parsed);
      if (problems.length === 0) {
        // compare_runs.ts reads this file, exactly as with --output-last-message.
        await writeFile(outputPath, JSON.stringify(parsed, null, 2), "utf8");
        return {
          result: parsed as T,
          stdout,
          stderr,
          exitCode,
          attempts: attempt,
        };
      }
      last = `schema mismatch on attempt ${attempt}: ${problems.join("; ")}`;
    } else {
      last = `no JSON object in reply on attempt ${attempt}`;
    }
  }
  throw new Error(`Visual judge failed after 2 attempts. ${last}`);
}
