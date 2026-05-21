import type {
  ActivationResult,
  PersonalityAnalysisInput,
  PlanetActivation,
  PlanetAgent,
  PlanetName,
} from './types.js'

const PLANET_ORDER: PlanetName[] = [
  'Sun',
  'Moon',
  'Mercury',
  'Venus',
  'Mars',
  'Jupiter',
  'Saturn',
]

interface ActivationRule {
  name: string
  matches: (text: string) => boolean
  planets: Partial<Record<PlanetName, number>>
  reasons: Partial<Record<PlanetName, string>>
}

const ACTIVATION_THRESHOLD = 0.35

const ACTIVATION_RULES: ActivationRule[] = [
  {
    name: 'Career',
    matches: (text) => /\b(career|job|work|profession|promotion|business|startup|company|venture)\b/.test(text),
    planets: { Sun: 0.22, Saturn: 0.24, Mars: 0.2, Jupiter: 0.22 },
    reasons: {
      Sun: 'identity, role, and future self',
      Saturn: 'career structure, responsibility, and stakes',
      Mars: 'work effort and decisive movement',
      Jupiter: 'professional growth and opportunity',
    },
  },
  {
    name: 'Love',
    matches: (text) => /\b(love|relationship|partner|dating|marriage|romance|connection|closeness)\b/.test(text),
    planets: { Moon: 0.32, Venus: 0.38, Mars: 0.18, Mercury: 0.26 },
    reasons: {
      Moon: 'emotional safety and attachment needs',
      Venus: 'love, values, attraction, and relational harmony',
      Mars: 'desire, defensiveness, or relational action',
      Mercury: 'communication and interpretation',
    },
  },
  {
    name: 'Money',
    matches: (text) => /\b(money|income|salary|financial|finance|cash|profit|revenue|wealth|earn|earning)\b/.test(text),
    planets: { Saturn: 0.32, Jupiter: 0.32, Venus: 0.35, Moon: 0.26 },
    reasons: {
      Saturn: 'financial caution, duty, and limits',
      Jupiter: 'growth, abundance, and upside',
      Venus: 'value, worth, and material comfort',
      Moon: 'security needs around resources',
    },
  },
  {
    name: 'Anger',
    matches: (text) => /\b(anger|angry|mad|furious|rage|resentful|resentment|snap)\b/.test(text),
    planets: { Mars: 0.48, Moon: 0.28, Saturn: 0.28 },
    reasons: {
      Mars: 'anger, impulse, and protective force',
      Moon: 'hurt, emotional charge, and safety needs',
      Saturn: 'restraint, boundaries, and consequences',
    },
  },
  {
    name: 'Confusion',
    matches: (text) => /\b(confused|confusion|unclear|unsure|uncertain|overthinking|mixed signals|not sure)\b/.test(text),
    planets: { Mercury: 0.42, Moon: 0.28, Saturn: 0.18 },
    reasons: {
      Mercury: 'interpretation, language, and meaning-making',
      Moon: 'emotional uncertainty under the question',
      Saturn: 'need for certainty before commitment',
    },
  },
  {
    name: 'Purpose',
    matches: (text) => /\b(purpose|meaning|identity|calling|direction|future self|who am i|becoming)\b/.test(text),
    planets: { Sun: 0.42, Jupiter: 0.32, Saturn: 0.24 },
    reasons: {
      Sun: 'identity, purpose, and visibility',
      Jupiter: 'meaning, belief, and wider horizon',
      Saturn: 'seriousness, timing, and long-term responsibility',
    },
  },
  {
    name: 'Business risk',
    matches: (text) =>
      /\b(business|startup|company|venture|entrepreneur|launch)\b/.test(text)
      && /\b(start|scared|afraid|fear|risk|risky|uncertain|hesitant|leap|launch)\b/.test(text),
    planets: { Sun: 0.24, Mars: 0.28, Jupiter: 0.28, Saturn: 0.34, Moon: 0.3 },
    reasons: {
      Sun: 'identity and future self in the business decision',
      Mars: 'action, starting, and courage',
      Jupiter: 'expansion and business growth',
      Saturn: 'fear, risk, structure, and consequence',
      Moon: 'emotional safety before movement',
    },
  },
  {
    name: 'Fear / hesitation',
    matches: (text) => /\b(fear|afraid|scared|hesitant|hesitation|worried|anxious|nervous|unsafe)\b/.test(text),
    planets: { Saturn: 0.36, Moon: 0.32 },
    reasons: {
      Saturn: 'fear, caution, delay, and structure',
      Moon: 'need for safety and reassurance',
    },
  },
  {
    name: 'Action / ambition',
    matches: (text) => /\b(start|launch|act|action|ambition|ambitious|drive|move|begin|build|do)\b/.test(text),
    planets: { Mars: 0.36, Sun: 0.22, Jupiter: 0.22 },
    reasons: {
      Mars: 'movement, initiative, and starting',
      Sun: 'agency and chosen identity',
      Jupiter: 'growth and possibility',
    },
  },
  {
    name: 'Risk',
    matches: (text) => /\b(risk|risky|risks|leap|bet|invest|investment)\b/.test(text),
    planets: { Saturn: 0.28, Jupiter: 0.26, Moon: 0.2, Mars: 0.12 },
    reasons: {
      Saturn: 'risk assessment and containment',
      Jupiter: 'upside and expansion',
      Moon: 'security needs under uncertainty',
      Mars: 'courage to act despite uncertainty',
    },
  },
  {
    name: 'Procrastination',
    matches: (text) => /\b(procrastinating|procrastination|putting off|delaying|delay|stuck|stalling|resistance|avoid doing)\b/.test(text),
    planets: { Mars: 0.46, Saturn: 0.44, Mercury: 0.36 },
    reasons: {
      Mars: 'blocked action and frustrated movement',
      Saturn: 'resistance, fear, and pressure',
      Mercury: 'knowing what to do and mentally looping',
    },
  },
  {
    name: 'Restraint / harm prevention',
    matches: (text) => /\b(hurt anyone|harm|control myself|hold back|restraint|boundary|boundaries|discipline)\b/.test(text),
    planets: { Saturn: 0.36, Mars: 0.22, Moon: 0.16 },
    reasons: {
      Saturn: 'boundary, restraint, and consequence',
      Mars: 'raw impulse requiring direction',
      Moon: 'care for emotional safety',
    },
  },
]

export function activatePlanets(
  input: PersonalityAnalysisInput,
  agents: PlanetAgent[],
): ActivationResult {
  const text = input.text.toLowerCase()
  const knownPlanets = new Set(agents.map((agent) => agent.planet))
  const scores = new Map<PlanetName, number>()
  const reasons = new Map<PlanetName, Set<string>>()
  const matchedThemes: string[] = []

  for (const planet of PLANET_ORDER) {
    scores.set(planet, 0)
    reasons.set(planet, new Set<string>())
  }

  for (const rule of ACTIVATION_RULES) {
    if (!rule.matches(text)) {
      continue
    }

    matchedThemes.push(rule.name)
    for (const [planet, weight] of Object.entries(rule.planets) as [PlanetName, number][]) {
      if (!knownPlanets.has(planet)) {
        continue
      }
      scores.set(planet, Math.min(1, (scores.get(planet) ?? 0) + weight))
      const reason = rule.reasons[planet]
      if (reason) {
        reasons.get(planet)?.add(reason)
      }
    }
  }

  if (matchedThemes.length === 0 && knownPlanets.has('Mercury')) {
    scores.set('Mercury', 0.4)
    reasons.get('Mercury')?.add('default sense-making for an unclassified reflection')
    matchedThemes.push('General reflection')
  }

  const activePlanets: PlanetActivation[] = PLANET_ORDER
    .filter((planet) => knownPlanets.has(planet))
    .map((planet) => ({
      planet,
      score: roundScore(scores.get(planet) ?? 0),
      reason: [...(reasons.get(planet) ?? new Set<string>())].join('; '),
    }))
    .filter((activation) => activation.score >= ACTIVATION_THRESHOLD)
    .sort((a, b) => b.score - a.score || PLANET_ORDER.indexOf(a.planet) - PLANET_ORDER.indexOf(b.planet))

  return {
    activePlanets,
    inactivePlanets: PLANET_ORDER.filter(
      (planet) => knownPlanets.has(planet) && !activePlanets.some((active) => active.planet === planet),
    ),
    matchedThemes,
  }
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100
}
