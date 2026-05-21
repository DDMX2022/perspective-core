import { activatePlanets } from './activation.js'
import { getDefaultPlanetAgents } from './agents.js'
import { extractCrux } from './crux.js'
import { getDominantInteraction, getRelevantInteractions } from './interactions.js'
import { MockLLMAdapter, buildPersonalityPrompt } from './llm.js'
import { buildMemoryCandidates } from './memory.js'
import { reflectOnInteraction } from './reflection.js'
import type { PersonalityAnalysisInput, PersonalityAnalysisResult } from './types.js'

export async function analyzePersonality(
  input: PersonalityAnalysisInput,
): Promise<PersonalityAnalysisResult> {
  const agents = getDefaultPlanetAgents()
  const activation = activatePlanets(input, agents)
  const interactions = getRelevantInteractions(activation.activePlanets)
  const dominantInteraction = getDominantInteraction(activation.activePlanets, interactions) ?? null
  const crux = extractCrux(input, activation, interactions)
  const memoryCandidates = buildMemoryCandidates(input, activation, crux, dominantInteraction)

  const prompt = buildPersonalityPrompt({
    input,
    agents,
    activation,
    interactions,
    dominantInteraction,
    crux,
    memoryCandidates,
  })

  const adapter = input.llmAdapter ?? new MockLLMAdapter()
  const response = await generateWithFallback(adapter, prompt)
  const reflection = reflectOnInteraction(
    input,
    {
      agents,
      activation,
      interactions,
      dominantInteraction,
      crux,
      memoryCandidates,
    },
    response,
  )

  return {
    response,
    activePlanets: activation.activePlanets,
    interactions,
    dominantInteraction,
    crux,
    reflection,
    memoryCandidates: reflection.memoryCandidates,
  }
}

async function generateWithFallback(
  adapter: PersonalityAnalysisInput['llmAdapter'],
  prompt: string,
): Promise<string> {
  try {
    return await adapter!.generateResponse(prompt)
  } catch {
    return new MockLLMAdapter().generateResponse(prompt)
  }
}
