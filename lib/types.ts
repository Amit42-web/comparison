// Shared request/response contracts for the /api/compare route.

export type Winner = "A" | "B" | "tie";
export type Confidence = "high" | "medium" | "low";

/** Request body sent from the client to POST /api/compare. */
export interface CompareRequest {
  /** The original prompt/instruction given to both models. */
  task: string;
  /** Output A. */
  outputA: string;
  /** Output B. */
  outputB: string;
  /** Optional judge model id override (stretch feature). */
  model?: string;
}

/**
 * The raw shape the judge model returns for a single pass. Winner/confidence
 * are always expressed in terms of the A/B labels *as presented to the model*
 * — callers are responsible for un-swapping when the inputs were flipped.
 */
export interface JudgeVerdict {
  reasoning: string;
  winner: Winner;
  confidence: Confidence;
  key_differentiator: string;
}

/** Successful response from POST /api/compare. */
export interface CompareResponse {
  /** Winner in terms of the original (un-swapped) A/B labels. */
  winner: Winner;
  confidence: Confidence;
  keyDifferentiator: string;
  reasoning: string;
  /**
   * True when the two order-swapped passes disagreed and a tie-breaking
   * pass was required — the UI surfaces a "close call" note in that case.
   */
  inconsistent: boolean;
}

/** Error response shape (any non-2xx status). */
export interface CompareErrorResponse {
  error: string;
}
