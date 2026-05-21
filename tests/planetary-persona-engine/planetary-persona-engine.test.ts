import {
  analyzePersonality,
  buildPersonalityPrompt,
  getDefaultPlanetAgents,
  interactionKey,
} from '../../src/planetary-persona-engine/index.js'
import type { PersonalityPromptState, PlanetActivation, PlanetName } from '../../src/planetary-persona-engine/index.js'

function activeNames(activePlanets: PlanetActivation[]): PlanetName[] {
  return activePlanets.map((activation) => activation.planet)
}

describe('planetary persona engine defaults', () => {
  it('returns all seven complete planet agents', () => {
    const agents = getDefaultPlanetAgents()

    expect(activeNames(agents.map((agent) => ({
      planet: agent.planet,
      score: agent.baseWeight,
      reason: agent.coreDrive,
    })))).toEqual(expect.arrayContaining([
      'Sun',
      'Moon',
      'Mercury',
      'Venus',
      'Mars',
      'Jupiter',
      'Saturn',
    ]))
    expect(agents).toHaveLength(7)

    for (const agent of agents) {
      expect(agent.agentName).toBeTruthy()
      expect(agent.coreDrive).toBeTruthy()
      expect(agent.strength).toBeTruthy()
      expect(agent.shadow).toBeTruthy()
      expect(agent.trigger).toBeTruthy()
      expect(agent.decisionBias).toBeTruthy()
      expect(agent.growthPath).toBeTruthy()
      expect(agent.baseWeight).toBeGreaterThan(0)
    }
  })
})

describe('analyzePersonality()', () => {
  it('detects business fear as expansion versus safety', async () => {
    const result = await analyzePersonality({
      text: 'I want to start my business but I am scared.',
    })

    expect(activeNames(result.activePlanets)).toEqual(expect.arrayContaining([
      'Sun',
      'Mars',
      'Jupiter',
      'Saturn',
      'Moon',
    ]))
    expect(result.crux.surfaceProblem).toBe('business/career decision')
    expect(result.crux.realCrux).toContain('expansion versus safety')
    expect(result.crux.emotionalNeed).toBe('security before movement')
    expect(result.crux.recommendedPath).toBe(
      'create a controlled 30-day validation plan before taking a full leap',
    )
    expect(result.dominantInteraction).not.toBeNull()
    expect(['Mars-Saturn', 'Jupiter-Saturn']).toContain(interactionKey(result.dominantInteraction!))
    expect(result.memoryCandidates.some((candidate) => candidate.pattern === 'freedom versus safety')).toBe(true)
    expect(result.reflection.shouldStoreMemory).toBe(true)
    expect(result.response).toContain('1. Inner Conflict')
    expect(result.response).toContain('5. One Follow-up Question')
  })

  it('detects procrastination as action versus fear or resistance', async () => {
    const result = await analyzePersonality({
      text: 'I keep procrastinating even though I know what to do.',
    })

    expect(activeNames(result.activePlanets)).toEqual(expect.arrayContaining([
      'Mars',
      'Saturn',
      'Mercury',
    ]))
    expect(result.crux.realCrux).toContain('action versus fear/resistance')
  })

  it('detects relationship confusion as emotion versus communication and values', async () => {
    const result = await analyzePersonality({
      text: 'I am confused about my relationship.',
    })

    expect(activeNames(result.activePlanets)).toEqual(expect.arrayContaining([
      'Moon',
      'Venus',
      'Mercury',
    ]))
    expect(result.crux.realCrux).toContain('emotion versus communication/value clarity')
  })

  it('detects anger restraint as impulse versus boundary', async () => {
    const result = await analyzePersonality({
      text: 'I am angry but I do not want to hurt anyone.',
    })

    expect(activeNames(result.activePlanets)).toEqual(expect.arrayContaining([
      'Mars',
      'Moon',
      'Saturn',
    ]))
    expect(result.crux.realCrux).toContain('impulse versus boundary')
  })

  it('detects money risk as growth versus security', async () => {
    const result = await analyzePersonality({
      text: 'I want more money but I am afraid of taking risks.',
    })

    expect(activeNames(result.activePlanets)).toEqual(expect.arrayContaining([
      'Jupiter',
      'Saturn',
      'Moon',
      'Venus',
    ]))
    expect(result.crux.realCrux).toContain('growth versus security')
  })
})

describe('buildPersonalityPrompt()', () => {
  it('includes safety framing and the required response outline', () => {
    const agents = getDefaultPlanetAgents()
    const state: PersonalityPromptState = {
      input: { text: 'I want to start my business but I am scared.' },
      agents,
      activation: {
        activePlanets: [
          { planet: 'Sun', score: 0.8, reason: 'identity' },
          { planet: 'Saturn', score: 0.9, reason: 'risk' },
        ],
        inactivePlanets: ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter'],
        matchedThemes: ['Business risk'],
      },
      interactions: [],
      dominantInteraction: null,
      crux: {
        surfaceProblem: 'business/career decision',
        realCrux: 'expansion versus safety',
        activePlanets: ['Sun', 'Saturn'],
        dominantConflict: 'none',
        emotionalNeed: 'security before movement',
        recommendedPath: 'create a controlled 30-day validation plan before taking a full leap',
      },
      memoryCandidates: [],
    }

    const prompt = buildPersonalityPrompt(state)

    expect(prompt).toContain('simulated reflective self-model')
    expect(prompt).toContain('symbolic personality engine')
    expect(prompt).toContain('do not claim real consciousness')
    expect(prompt).toContain('1. Inner Conflict')
    expect(prompt).toContain('5. One Follow-up Question')
  })
})
