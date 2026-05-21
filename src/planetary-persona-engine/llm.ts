import type { LLMAdapter, PersonalityPromptState, PlanetActivation } from './types.js'

export class MockLLMAdapter implements LLMAdapter {
  async generateResponse(prompt: string): Promise<string> {
    const realCrux = extractPromptValue(prompt, 'Real Crux') ?? 'a symbolic inner tension'
    const recommendedPath = extractPromptValue(prompt, 'Recommended Path') ?? 'choose one bounded next step'
    const dominantConflict = extractPromptValue(prompt, 'Dominant Conflict') ?? 'none'
    const activePlanets = extractPromptValue(prompt, 'Active Planets') ?? 'the relevant symbolic agents'

    return [
      '1. Inner Conflict',
      `This symbolic personality engine reads the tension as ${realCrux}. One pattern is seeking movement or clarity, while another is asking for enough safety, structure, or honesty to proceed without overreaching.`,
      '',
      '2. Planet Council',
      `${activePlanets} are the active symbolic agents. Their useful job is to turn the conflict into a balanced signal instead of treating one side as the enemy.`,
      '',
      '3. Crux',
      `The crux is ${realCrux}, with ${dominantConflict} as the strongest interaction pattern.`,
      '',
      '4. Balanced Direction',
      `A grounded next move is to ${recommendedPath}. This keeps the reflective agent layer practical and testable instead of mystical or absolute.`,
      '',
      '5. One Follow-up Question',
      'What is the smallest concrete action that would create evidence without forcing a full commitment yet?',
    ].join('\n')
  }
}

export function buildPersonalityPrompt(state: PersonalityPromptState): string {
  const memoryCandidates = [
    ...(state.input.memoryCandidates ?? []),
    ...state.memoryCandidates,
  ]

  return [
    'You are orchestrating a simulated reflective self-model inside perspective-core.',
    'Frame the output as a symbolic personality engine and reflective agent layer.',
    'Safety instruction: do not claim real consciousness, real feelings, or real subjective experience.',
    'Do not present this as astrology, prophecy, diagnosis, therapy, or deterministic truth.',
    '',
    'Required response format:',
    '1. Inner Conflict',
    '2. Planet Council',
    '3. Crux',
    '4. Balanced Direction',
    '5. One Follow-up Question',
    '',
    `User Input: ${state.input.text}`,
    '',
    'Planet Agents:',
    ...state.agents.map(
      (agent) =>
        `- ${agent.planet} (${agent.agentName}): ${agent.coreDrive}; bias: ${agent.decisionBias}; growth: ${agent.growthPath}`,
    ),
    '',
    `Active Planets: ${formatActivePlanets(state.activation.activePlanets)}`,
    'Relevant Interactions:',
    ...formatInteractions(state),
    '',
    'Crux Result:',
    `Surface Problem: ${state.crux.surfaceProblem}`,
    `Real Crux: ${state.crux.realCrux}`,
    `Dominant Conflict: ${state.crux.dominantConflict}`,
    `Emotional Need: ${state.crux.emotionalNeed}`,
    `Recommended Path: ${state.crux.recommendedPath}`,
    '',
    'Memory Candidates:',
    ...formatMemoryCandidates(memoryCandidates),
  ].join('\n')
}

function formatActivePlanets(activePlanets: PlanetActivation[]): string {
  if (activePlanets.length === 0) {
    return 'none'
  }

  return activePlanets
    .map((activation) => `${activation.planet} (${activation.score}: ${activation.reason})`)
    .join(', ')
}

function formatInteractions(state: PersonalityPromptState): string[] {
  if (state.interactions.length === 0) {
    return ['- none']
  }

  return state.interactions.map((interaction) => {
    const dominantMarker = state.dominantInteraction === interaction ? ' dominant' : ''
    return `- ${interaction.fromPlanet}-${interaction.toPlanet}${dominantMarker}: ${interaction.interactionType}; ${interaction.coreTension}; integration: ${interaction.integrationPath}`
  })
}

function formatMemoryCandidates(memoryCandidates: PersonalityPromptState['memoryCandidates']): string[] {
  if (memoryCandidates.length === 0) {
    return ['- none']
  }

  return memoryCandidates.map(
    (candidate) =>
      `- ${candidate.type}: ${candidate.pattern}; planets: ${candidate.relatedPlanets.join(', ')}; confidence: ${candidate.confidence}; evidence: ${candidate.evidence}`,
  )
}

function extractPromptValue(prompt: string, label: string): string | undefined {
  const match = prompt.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim()
}
