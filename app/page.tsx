"use client";

import { useCallback, useRef, useState } from "react";
import type {
  CompareRequest,
  CompareResponse,
  Confidence,
  Winner,
} from "@/lib/types";

const winnerStyles: Record<Winner, string> = {
  A: "bg-blue-100 text-blue-800 ring-blue-200",
  B: "bg-violet-100 text-violet-800 ring-violet-200",
  tie: "bg-neutral-200 text-neutral-800 ring-neutral-300",
};

const confidenceStyles: Record<Confidence, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-rose-100 text-rose-800",
};

/** Names that were in effect for a completed comparison. */
interface JudgedNames {
  a: string;
  b: string;
}

function winnerText(winner: Winner, names: JudgedNames): string {
  if (winner === "tie") return "Tie";
  return `${winner === "A" ? names.a : names.b} wins`;
}

export default function Home() {
  // Uncontrolled output inputs: the (potentially huge) pasted text lives in the
  // DOM, not React state, so pasting large outputs doesn't re-render the tree.
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const outputARef = useRef<HTMLTextAreaElement>(null);
  const outputBRef = useRef<HTMLTextAreaElement>(null);

  // Editable, per-comparison display names. Small strings — controlled is fine.
  const [nameA, setNameA] = useState("Output A");
  const [nameB, setNameB] = useState("Output B");

  // Lightweight non-empty flags drive the button's enabled state.
  const [hasTask, setHasTask] = useState(false);
  const [hasA, setHasA] = useState(false);
  const [hasB, setHasB] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  // Snapshot of the names used for the shown result, so editing the name inputs
  // afterward doesn't retroactively relabel a verdict.
  const [judgedNames, setJudgedNames] = useState<JudgedNames>({
    a: "Output A",
    b: "Output B",
  });

  const canSubmit = !loading && hasTask && hasA && hasB;

  async function handleCompare() {
    if (loading) return; // loading-lock: no double submit

    const task = taskRef.current?.value ?? "";
    const outputA = outputARef.current?.value ?? "";
    const outputB = outputBRef.current?.value ?? "";
    if (!task.trim() || !outputA.trim() || !outputB.trim()) return;

    const names: JudgedNames = {
      a: nameA.trim() || "Output A",
      b: nameB.trim() || "Output B",
    };

    setLoading(true);
    setError(null);
    setResult(null);

    const payload: CompareRequest = { task, outputA, outputB };

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }
      setJudgedNames(names);
      setResult(data as CompareResponse);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Output Judge</h1>
        <p className="mt-2 text-neutral-600">
          Compare two AI outputs for the same task and see which is better — with
          bias-mitigated reasoning.
        </p>
      </header>

      <div className="space-y-5">
        <Field
          label="Task / Prompt given to both models"
          inputRef={taskRef}
          onFilledChange={setHasTask}
          placeholder="e.g. Summarize this article in three bullet points…"
          rows={3}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <OutputField
            name={nameA}
            onNameChange={setNameA}
            inputRef={outputARef}
            onFilledChange={setHasA}
            placeholder="Paste the first output…"
            rows={8}
          />
          <OutputField
            name={nameB}
            onNameChange={setNameB}
            inputRef={outputBRef}
            onFilledChange={setHasB}
            placeholder="Paste the second output…"
            rows={8}
          />
        </div>

        <button
          onClick={handleCompare}
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition enabled:hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Judging…" : "Compare"}
        </button>
      </div>

      {error && (
        <div className="mt-8 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {result && (
        <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${winnerStyles[result.winner]}`}
            >
              {winnerText(result.winner, judgedNames)}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${confidenceStyles[result.confidence]}`}
            >
              {result.confidence} confidence
            </span>
          </div>

          <dl className="mt-5 space-y-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Key differentiator
              </dt>
              <dd className="mt-1 text-neutral-900">
                {result.keyDifferentiator}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Reasoning
              </dt>
              <dd className="mt-1 leading-relaxed text-neutral-800">
                {result.reasoning}
              </dd>
            </div>
          </dl>

          {result.inconsistent && (
            <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Close call — evaluator was inconsistent between passes. This
              verdict comes from a tie-breaking re-check.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

/** Plain labeled textarea (used for the task/prompt). */
function Field({
  label,
  inputRef,
  onFilledChange,
  placeholder,
  rows,
}: {
  label: string;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onFilledChange: (filled: boolean) => void;
  placeholder?: string;
  rows: number;
}) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onFilledChange(e.target.value.trim().length > 0);
    },
    [onFilledChange]
  );

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      <textarea
        ref={inputRef}
        defaultValue=""
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        className="block w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
      />
    </label>
  );
}

/** An output with an editable name box on top and its (uncontrolled) textarea. */
function OutputField({
  name,
  onNameChange,
  inputRef,
  onFilledChange,
  placeholder,
  rows,
}: {
  name: string;
  onNameChange: (name: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onFilledChange: (filled: boolean) => void;
  placeholder?: string;
  rows: number;
}) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onFilledChange(e.target.value.trim().length > 0);
    },
    [onFilledChange]
  );

  return (
    <div className="block">
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Name this output…"
        aria-label="Output name"
        className="mb-1.5 block w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-neutral-800 outline-none transition hover:border-neutral-200 focus:border-neutral-300 focus:bg-white focus:ring-2 focus:ring-neutral-200"
      />
      <textarea
        ref={inputRef}
        defaultValue=""
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        className="block w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
      />
    </div>
  );
}
