import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { JudgeVerdict } from "./types";

/**
 * The judge system prompt. This has been designed and tested — do not rewrite.
 * The {{task}} / {{output_a}} / {{output_b}} placeholders are filled per call.
 */
export const JUDGE_PROMPT = `You are an expert evaluator comparing two AI-generated outputs for the same input/task. Your job is to determine which output is better and explain why, with no bias toward either position.

You will receive:
- TASK: the original prompt/instruction given to both models
- OUTPUT A
- OUTPUT B

Evaluate strictly on these dimensions (in order of priority):
1. Correctness/Accuracy — factual errors, logical flaws, hallucinations
2. Instruction adherence — did it actually do what was asked, including format/constraints
3. Completeness — missing steps, edge cases, or requested elements
4. Clarity & structure — readability, organization, appropriate length (not padded, not truncated)
5. Usefulness/actionability — would a real user be able to act on this without further clarification

Do not favor an answer for being longer, more confident-sounding, or more verbose — evaluate substance only.

Respond ONLY in this JSON format, no preamble:

{
  "reasoning": "2-4 sentences comparing A and B on the dimensions above, citing specific differences (not generic praise)",
  "winner": "A" | "B" | "tie",
  "confidence": "high" | "medium" | "low",
  "key_differentiator": "one short phrase naming the single biggest factor that decided this"
}

TASK:
{{task}}

OUTPUT A:
{{output_a}}

OUTPUT B:
{{output_b}}
`;

/**
 * Inputs for a single judging pass. `outputA`/`outputB` are whatever will be
 * shown to the model in the "A" and "B" slots — the caller decides ordering.
 */
export interface JudgeInput {
  task: string;
  outputA: string;
  outputB: string;
  /**
   * Optional extra instruction appended to the prompt (used for the neutral
   * tie-breaking re-check pass).
   */
  note?: string;
}

/**
 * Abstraction over "call a model and get a structured verdict back". Swap
 * providers (OpenAI, Anthropic, …) without touching the API route.
 */
export interface JudgeModel {
  /** Human-readable id of the model this instance judges with. */
  readonly modelId: string;
  judge(input: JudgeInput): Promise<JudgeVerdict>;
}

/** JSON-schema description of the verdict — reused across providers. */
const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description:
        "2-4 sentences comparing A and B on the evaluation dimensions, citing specific differences.",
    },
    winner: { type: "string", enum: ["A", "B", "tie"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    key_differentiator: {
      type: "string",
      description: "One short phrase naming the single biggest deciding factor.",
    },
  },
  required: ["reasoning", "winner", "confidence", "key_differentiator"],
  additionalProperties: false,
} as const;

function buildPrompt(input: JudgeInput): string {
  let prompt = JUDGE_PROMPT.replace("{{task}}", input.task)
    .replace("{{output_a}}", input.outputA)
    .replace("{{output_b}}", input.outputB);
  if (input.note) {
    prompt += `\n\n${input.note}`;
  }
  return prompt;
}

function isVerdict(value: unknown): value is JudgeVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.reasoning === "string" &&
    (v.winner === "A" || v.winner === "B" || v.winner === "tie") &&
    (v.confidence === "high" ||
      v.confidence === "medium" ||
      v.confidence === "low") &&
    typeof v.key_differentiator === "string"
  );
}

/**
 * Wraps a single-attempt call with one retry: if the model returns something
 * we can't validate, try once more before surfacing an error.
 */
async function withRetry(
  callOnce: () => Promise<JudgeVerdict>
): Promise<JudgeVerdict> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callOnce();
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Judge failed to return a valid verdict: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

/**
 * OpenAI-backed judge (default). Uses strict function-calling so the model is
 * forced to return JSON matching the verdict schema.
 */
export class OpenAIJudge implements JudgeModel {
  readonly modelId: string;
  private client: OpenAI;

  constructor(modelId: string = process.env.JUDGE_MODEL || "gpt-4o") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    this.client = new OpenAI({ apiKey });
    this.modelId = modelId;
  }

  judge(input: JudgeInput): Promise<JudgeVerdict> {
    return withRetry(() => this.callOnce(input));
  }

  private async callOnce(input: JudgeInput): Promise<JudgeVerdict> {
    const completion = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [{ role: "user", content: buildPrompt(input) }],
      tools: [
        {
          type: "function",
          function: {
            name: "report_verdict",
            description:
              "Report the structured evaluation verdict comparing OUTPUT A and OUTPUT B.",
            parameters: VERDICT_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "report_verdict" },
      },
    });

    const call = completion.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== "function") {
      throw new Error("Model did not return a function call");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new Error("Verdict arguments were not valid JSON");
    }
    if (!isVerdict(parsed)) {
      throw new Error("Verdict did not match the expected schema");
    }
    return parsed;
  }
}

/** Anthropic-backed judge. Uses tool-use to force a valid structured verdict. */
export class AnthropicJudge implements JudgeModel {
  readonly modelId: string;
  private client: Anthropic;

  constructor(modelId: string = process.env.JUDGE_MODEL || "claude-sonnet-4-5") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    this.client = new Anthropic({ apiKey });
    this.modelId = modelId;
  }

  judge(input: JudgeInput): Promise<JudgeVerdict> {
    return withRetry(() => this.callOnce(input));
  }

  private async callOnce(input: JudgeInput): Promise<JudgeVerdict> {
    const message = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 1024,
      tools: [
        {
          name: "report_verdict",
          description:
            "Report the structured evaluation verdict comparing OUTPUT A and OUTPUT B.",
          input_schema: VERDICT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "report_verdict" },
      messages: [{ role: "user", content: buildPrompt(input) }],
    });

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUse) {
      throw new Error("Model did not return a tool_use block");
    }
    if (!isVerdict(toolUse.input)) {
      throw new Error("Verdict did not match the expected schema");
    }
    return toolUse.input;
  }
}

/**
 * Factory so the route doesn't hardcode a provider. Defaults to OpenAI; set
 * JUDGE_PROVIDER=anthropic to use Claude instead.
 */
export function createJudge(modelId?: string): JudgeModel {
  const provider = (process.env.JUDGE_PROVIDER || "openai").toLowerCase();
  if (provider === "anthropic") {
    return new AnthropicJudge(modelId);
  }
  return new OpenAIJudge(modelId);
}
