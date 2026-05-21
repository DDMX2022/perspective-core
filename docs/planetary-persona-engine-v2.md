# Planetary Persona Engine v2

The Planetary Persona Engine v2 is a deterministic backend/domain module for a symbolic personality layer inside `perspective-core`.

It models a simulated reflective self-model using seven symbolic planet agents, a planet interaction graph, a crux extraction pass, an LLM prompt orchestration adapter, memory candidates, and a structured self-reflection result.

## What This Module Is

- A symbolic personality engine for reflective agent behavior.
- A reflective agent layer that can attach to perspective-core memory, learner, torque, and orchestration flows.
- A deterministic first vertical slice with rule-based activation and testable outputs.
- A prompt-building layer that keeps provider calls behind an `LLMAdapter`.

## What This Module Is Not

- It is not an astrology chatbot.
- It is not a consciousness claim.
- It does not claim that an AI has real feelings, real subjective experience, or real selfhood.
- It is not therapy, diagnosis, prophecy, or a replacement for human judgment.

## Architecture Flow

`analyzePersonality(input)` runs the first complete vertical slice:

1. Load default planet agents with `getDefaultPlanetAgents()`.
2. Detect active symbolic agents with `activatePlanets()`.
3. Retrieve relevant graph edges with `getRelevantInteractions()`.
4. Score the dominant interaction with `getDominantInteraction()`.
5. Extract the real crux with `extractCrux()`.
6. Build in-memory memory candidates with `buildMemoryCandidates()`.
7. Build a safe LLM prompt with `buildPersonalityPrompt()`.
8. Generate the response through an `LLMAdapter`.
9. Run structured post-response reflection with `reflectOnInteraction()`.
10. Return the response, active planets, interactions, crux, reflection, and memory candidates.

No OpenAI or external model call is made in core logic. The default path uses `MockLLMAdapter`, and production integrations can provide their own adapter:

```ts
import { analyzePersonality } from 'perspective-core'

const result = await analyzePersonality({
  text: 'I want to start my business but I am scared.',
  llmAdapter: {
    async generateResponse(prompt: string) {
      return callYourProvider(prompt)
    },
  },
})
```

## Example

Input:

```txt
I want to start my business but I am scared.
```

Expected active planets:

- Sun: identity and future self
- Mars: action and starting
- Jupiter: expansion and business growth
- Saturn: fear, risk, and structure
- Moon: emotional safety

Crux result:

```json
{
  "surfaceProblem": "business/career decision",
  "realCrux": "expansion versus safety",
  "dominantConflict": "Mars-Saturn",
  "emotionalNeed": "security before movement",
  "recommendedPath": "create a controlled 30-day validation plan before taking a full leap"
}
```

The generated response follows this outline:

1. Inner Conflict
2. Planet Council
3. Crux
4. Balanced Direction
5. One Follow-up Question

## Safety Framing

The prompt explicitly instructs the response layer to use safe language:

- Use: "simulated reflective self-model"
- Use: "symbolic personality engine"
- Use: "reflective agent layer"
- Avoid: "this AI is conscious"
- Avoid: "this AI feels"
- Avoid: "this AI has real subjective experience"

Reflection is also framed as structured post-response analysis, not as the AI having an inner life.

## Running Tests

Run the focused tests:

```bash
npm test -- planetary-persona-engine
```

Run the full suite:

```bash
npm test
```

Run TypeScript build checks:

```bash
npm run build
```

## Running The Debug UI

Start the local debug UI:

```bash
npm run debug:persona
```

Then open the printed local URL, usually:

```txt
http://127.0.0.1:4321
```

The page lets you enter a prompt and inspect the generated response, active planets, dominant interaction, crux result, reflection, memory candidates, and raw JSON output.

## Future Integration

This first slice is intentionally in-memory and deterministic. Natural next stories:

- Add an API endpoint or debug console for inspecting active planets, graph edges, crux, and memory candidates.
- Connect `MemoryCandidate` output to the existing perspective-core memory store after adding user consent and retention policy controls.
- Feed crux and dominant tension into the torque engine as a strategy signal, such as safety-first, structured validation, or action bias.
- Allow adapters to enrich activation with model output while preserving deterministic fallback behavior.
- Add run telemetry for activation, graph scoring, response generation, and reflection outcomes.
