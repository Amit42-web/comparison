# Output Judge

A minimal web app that compares two AI-generated outputs for the same task and
tells you which is better — with reasoning, a confidence level, and a
bias-mitigation step so ordering doesn't sway the verdict.

## How it works

The `/api/compare` route implements a **bias-mitigated single-prompt judge**:

1. The judge model is called with `(Output A, Output B)`.
2. It's called again with the order **swapped** — `(Output B, Output A)` — in
   parallel, and the result is mapped back to the original A/B labels.
3. If both passes agree, that winner is returned (confidence upgraded to `high`
   only when both passes were high).
4. If the passes disagree, a neutral **tie-breaking** pass runs and the response
   is flagged `inconsistent: true`, which the UI surfaces as a "close call" note.

The judge uses the provider's strict tool/function-calling mode to guarantee a
valid structured verdict, with one automatic retry on any parse/validation
failure. The model call sits behind a `JudgeModel` interface (`lib/judge.ts`),
so providers can be swapped without touching the API route. **OpenAI is the
default**; set `JUDGE_PROVIDER=anthropic` to use Claude instead.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- `openai` for the default judge model (`@anthropic-ai/sdk` available as an
  alternative provider)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from the example and add your OpenAI API key:

   ```bash
   cp .env.example .env.local
   # then edit .env.local and set OPENAI_API_KEY
   ```

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Testing the API directly

```bash
curl -s http://localhost:3000/api/compare \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Explain what a closure is in JavaScript, briefly.",
    "outputA": "A closure is when a function remembers the variables from where it was defined.",
    "outputB": "Closures are a feature. They are useful and powerful in programming."
  }' | jq
```

Expected response shape:

```json
{
  "winner": "A",
  "confidence": "high",
  "keyDifferentiator": "concrete, accurate explanation",
  "reasoning": "…",
  "inconsistent": false
}
```

## Environment variables

| Variable            | Required             | Description                                                        |
| ------------------- | -------------------- | ----------------------------------------------------------------- |
| `OPENAI_API_KEY`    | yes (default)        | OpenAI API key used by the default judge model.                   |
| `JUDGE_PROVIDER`    | no                   | `openai` (default) or `anthropic`.                                |
| `ANTHROPIC_API_KEY` | if provider=anthropic | Anthropic API key, used when `JUDGE_PROVIDER=anthropic`.          |
| `JUDGE_MODEL`       | no                   | Override the judge model id (default `gpt-4o` / `claude-sonnet-4-5`). |

## Deploying to Vercel

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com/new), import the repository.
3. Add the `OPENAI_API_KEY` environment variable in **Project Settings →
   Environment Variables** (plus `JUDGE_PROVIDER`/`ANTHROPIC_API_KEY` if you
   want to use Claude instead).
4. Deploy. Vercel auto-detects Next.js — no extra configuration needed.

> The `/api/compare` route is allowed up to 60s (`maxDuration`) to accommodate
> the tie-breaking third pass.

## Roadmap (stretch)

- N-way comparison via pairwise round-robin + ranking
- Judge-model dropdown in the UI
- "Swap A/B" button to manually re-run flipped
