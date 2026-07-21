import { NextRequest, NextResponse } from "next/server";
import { createJudge, type JudgeModel } from "@/lib/judge";
import type {
  CompareRequest,
  CompareResponse,
  Confidence,
  JudgeVerdict,
  Winner,
} from "@/lib/types";

// Judge calls can take a while; give them room on Vercel.
export const maxDuration = 60;

/** Flip a winner between the A/B label space. `tie` is unaffected. */
function flipWinner(winner: Winner): Winner {
  if (winner === "A") return "B";
  if (winner === "B") return "A";
  return "tie";
}

/** Pick the stronger of two confidence levels. */
function maxConfidence(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function validate(body: unknown): CompareRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const task = b.task;
  const outputA = b.outputA;
  const outputB = b.outputB;
  if (
    typeof task !== "string" ||
    typeof outputA !== "string" ||
    typeof outputB !== "string"
  ) {
    return null;
  }
  if (!task.trim() || !outputA.trim() || !outputB.trim()) return null;
  const model = typeof b.model === "string" ? b.model : undefined;
  return { task, outputA, outputB, model };
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const request = validate(raw);
  if (!request) {
    return NextResponse.json(
      { error: "task, outputA, and outputB are all required and must be non-empty." },
      { status: 400 }
    );
  }

  let judge: JudgeModel;
  try {
    judge = createJudge(request.model);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to init judge." },
      { status: 500 }
    );
  }

  try {
    // Pass 1: A, B as-is. Pass 2: B, A swapped. Run in parallel for latency.
    const [passForward, passSwappedRaw] = await Promise.all([
      judge.judge({
        task: request.task,
        outputA: request.outputA,
        outputB: request.outputB,
      }),
      judge.judge({
        task: request.task,
        outputA: request.outputB,
        outputB: request.outputA,
      }),
    ]);

    // Map the swapped pass back into the original A/B label space.
    const passSwapped: JudgeVerdict = {
      ...passSwappedRaw,
      winner: flipWinner(passSwappedRaw.winner),
    };

    let response: CompareResponse;

    if (passForward.winner === passSwapped.winner) {
      // Both passes agree — combine, upgrading confidence when both agreed.
      response = {
        winner: passForward.winner,
        confidence: maxConfidence(passForward.confidence, passSwapped.confidence),
        keyDifferentiator: passForward.key_differentiator,
        reasoning: passForward.reasoning,
        inconsistent: false,
      };
    } else {
      // Disagreement — neutral tie-breaking re-check.
      const tieBreak = await judge.judge({
        task: request.task,
        outputA: request.outputA,
        outputB: request.outputB,
        note: "Note: this is a re-check. Evaluate the two outputs afresh and impartially, without assuming any prior verdict.",
      });
      response = {
        winner: tieBreak.winner,
        confidence: tieBreak.confidence,
        keyDifferentiator: tieBreak.key_differentiator,
        reasoning: tieBreak.reasoning,
        inconsistent: true,
      };
    }

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "The judge could not complete the comparison. Please try again.",
      },
      { status: 502 }
    );
  }
}
