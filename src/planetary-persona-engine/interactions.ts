import type { PlanetActivation, PlanetInteraction, PlanetName } from './types.js'

const DEFAULT_PLANET_INTERACTIONS: PlanetInteraction[] = [
  {
    fromPlanet: 'Mars',
    toPlanet: 'Saturn',
    interactionType: 'conflict',
    coreTension: 'action versus control',
    behaviorPattern: 'wants movement but delays due to fear or structure',
    shadowPattern: 'frustration, self-doubt, anger turned inward',
    integrationPath: 'disciplined action',
    strength: 0.95,
  },
  {
    fromPlanet: 'Jupiter',
    toPlanet: 'Saturn',
    interactionType: 'conflict',
    coreTension: 'expansion versus structure',
    behaviorPattern: 'dreams big but restricts movement until certainty appears',
    shadowPattern: 'over-planning, missed opportunities',
    integrationPath: 'controlled expansion',
    strength: 0.9,
  },
  {
    fromPlanet: 'Moon',
    toPlanet: 'Saturn',
    interactionType: 'suppression',
    coreTension: 'emotional safety versus emotional control',
    behaviorPattern: 'feels deeply but suppresses vulnerability',
    shadowPattern: 'loneliness, emotional distance',
    integrationPath: 'safe emotional expression',
    strength: 0.85,
  },
  {
    fromPlanet: 'Moon',
    toPlanet: 'Mercury',
    interactionType: 'translation',
    coreTension: 'feeling versus interpretation',
    behaviorPattern: 'thinks about feelings instead of fully feeling them',
    shadowPattern: 'over-analysis, confusion',
    integrationPath: 'name the feeling, then reason with it',
    strength: 0.78,
  },
  {
    fromPlanet: 'Venus',
    toPlanet: 'Mars',
    interactionType: 'conflict',
    coreTension: 'connection versus desire/action',
    behaviorPattern: 'wants closeness but may act defensively or impatiently',
    shadowPattern: 'attraction mixed with conflict',
    integrationPath: 'assertive but kind expression',
    strength: 0.76,
  },
  {
    fromPlanet: 'Sun',
    toPlanet: 'Saturn',
    interactionType: 'conflict',
    coreTension: 'visibility versus judgment',
    behaviorPattern: 'wants to express identity but fears consequences',
    shadowPattern: 'self-censorship, delayed confidence',
    integrationPath: 'structured self-expression',
    strength: 0.82,
  },
]

export function getDefaultPlanetInteractions(): PlanetInteraction[] {
  return DEFAULT_PLANET_INTERACTIONS.map((interaction) => ({ ...interaction }))
}

export function getRelevantInteractions(activePlanets: PlanetActivation[]): PlanetInteraction[] {
  const activePlanetNames = new Set(activePlanets.map((activation) => activation.planet))

  return getDefaultPlanetInteractions()
    .filter(
      (interaction) =>
        activePlanetNames.has(interaction.fromPlanet) && activePlanetNames.has(interaction.toPlanet),
    )
    .sort(
      (a, b) =>
        scoreInteraction(b, activePlanets) - scoreInteraction(a, activePlanets)
        || interactionKey(a).localeCompare(interactionKey(b)),
    )
}

export function getDominantInteraction(
  activePlanets: PlanetActivation[],
  interactions: PlanetInteraction[] = getRelevantInteractions(activePlanets),
): PlanetInteraction | undefined {
  return [...interactions].sort(
    (a, b) =>
      scoreInteraction(b, activePlanets) - scoreInteraction(a, activePlanets)
      || interactionKey(a).localeCompare(interactionKey(b)),
  )[0]
}

export function scoreInteraction(
  interaction: PlanetInteraction,
  activePlanets: PlanetActivation[],
): number {
  const scores = new Map<PlanetName, number>(
    activePlanets.map((activation) => [activation.planet, activation.score]),
  )

  return roundScore(
    (scores.get(interaction.fromPlanet) ?? 0)
    + (scores.get(interaction.toPlanet) ?? 0)
    + interaction.strength,
  )
}

export function interactionKey(interaction: PlanetInteraction): string {
  return `${interaction.fromPlanet}-${interaction.toPlanet}`
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100
}
