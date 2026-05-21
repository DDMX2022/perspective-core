import type {
  ActivationResult,
  CruxResult,
  MemoryCandidate,
  PersonalityAnalysisInput,
  PlanetInteraction,
  PlanetName,
} from './types.js'

export function buildMemoryCandidates(
  input: PersonalityAnalysisInput,
  activation: ActivationResult,
  crux: CruxResult,
  dominantInteraction: PlanetInteraction | null,
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = []

  candidates.push({
    type: 'crux_pattern',
    pattern: crux.realCrux,
    relatedPlanets: crux.activePlanets,
    evidence: evidenceFrom(input.text, crux.surfaceProblem),
    confidence: confidenceFor(activation, dominantInteraction, 0.58),
  })

  if (dominantInteraction) {
    candidates.push({
      type: 'conflict_pattern',
      pattern: memoryPatternFor(crux, dominantInteraction),
      relatedPlanets: relatedPlanetsFor(crux, dominantInteraction),
      evidence: evidenceFrom(input.text, dominantInteraction.behaviorPattern),
      confidence: confidenceFor(activation, dominantInteraction, 0.62),
    })
  }

  return candidates
}

function memoryPatternFor(crux: CruxResult, dominantInteraction: PlanetInteraction): string {
  if (crux.realCrux === 'expansion versus safety') {
    return 'freedom versus safety'
  }
  if (crux.realCrux === 'growth versus security') {
    return 'growth versus security'
  }
  return dominantInteraction.coreTension
}

function relatedPlanetsFor(
  crux: CruxResult,
  dominantInteraction: PlanetInteraction,
): PlanetName[] {
  const planets: PlanetName[] = [dominantInteraction.fromPlanet, dominantInteraction.toPlanet]
  if (
    crux.emotionalNeed.includes('security')
    || crux.emotionalNeed.includes('safety')
  ) {
    planets.push('Moon')
  }
  return [...new Set(planets)]
}

function confidenceFor(
  activation: ActivationResult,
  dominantInteraction: PlanetInteraction | null,
  base: number,
): number {
  const activationBoost = Math.min(0.18, activation.activePlanets.length * 0.03)
  const interactionBoost = dominantInteraction ? dominantInteraction.strength * 0.08 : 0
  return Math.round(Math.min(0.92, base + activationBoost + interactionBoost) * 100) / 100
}

function evidenceFrom(inputText: string, pattern: string): string {
  return `User input "${inputText}" indicates ${pattern}.`
}
