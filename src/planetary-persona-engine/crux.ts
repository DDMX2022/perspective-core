import { getDominantInteraction, interactionKey } from './interactions.js'
import type {
  ActivationResult,
  CruxResult,
  PersonalityAnalysisInput,
  PlanetInteraction,
  PlanetName,
} from './types.js'

export function extractCrux(
  input: PersonalityAnalysisInput,
  activation: ActivationResult,
  interactions: PlanetInteraction[],
): CruxResult {
  const text = input.text.toLowerCase()
  const activePlanets = activation.activePlanets.map((active) => active.planet)
  const dominantInteraction = getDominantInteraction(activation.activePlanets, interactions)
  const dominantConflict = dominantInteraction ? interactionKey(dominantInteraction) : 'none'

  if (
    /\b(business|startup|company|venture|entrepreneur|launch)\b/.test(text)
    && /\b(start|scared|afraid|fear|risk|risky|hesitant|uncertain|leap)\b/.test(text)
  ) {
    return {
      surfaceProblem: 'business/career decision',
      realCrux: 'expansion versus safety',
      activePlanets,
      dominantConflict,
      emotionalNeed: 'security before movement',
      recommendedPath: 'create a controlled 30-day validation plan before taking a full leap',
    }
  }

  if (/\b(procrastinating|procrastination|putting off|delaying|delay|stuck|stalling|resistance|avoid doing)\b/.test(text)) {
    return {
      surfaceProblem: 'procrastination/action delay',
      realCrux: 'action versus fear/resistance',
      activePlanets: ensurePlanets(activePlanets, ['Mars', 'Saturn', 'Mercury']),
      dominantConflict,
      emotionalNeed: 'permission to move imperfectly with structure',
      recommendedPath: 'choose one small bounded action and complete it before renegotiating the larger plan',
    }
  }

  if (
    /\b(relationship|partner|love|dating|marriage|romance|connection|closeness)\b/.test(text)
    && /\b(confused|confusion|unclear|unsure|uncertain|mixed signals|not sure)\b/.test(text)
  ) {
    return {
      surfaceProblem: 'relationship clarity',
      realCrux: 'emotion versus communication/value clarity',
      activePlanets: ensurePlanets(activePlanets, ['Moon', 'Venus', 'Mercury']),
      dominantConflict,
      emotionalNeed: 'honest emotional safety before a clean conversation',
      recommendedPath: 'name the feeling, clarify the value at stake, then ask one direct and kind question',
    }
  }

  if (/\b(anger|angry|mad|furious|rage|resentful|resentment|snap)\b/.test(text)) {
    return {
      surfaceProblem: 'anger and restraint',
      realCrux: 'impulse versus boundary',
      activePlanets: ensurePlanets(activePlanets, ['Mars', 'Moon', 'Saturn']),
      dominantConflict,
      emotionalNeed: 'safe expression without harm',
      recommendedPath: 'release the charge through a non-harmful action, then state the boundary in plain language',
    }
  }

  if (
    /\b(money|income|salary|financial|finance|cash|profit|revenue|wealth|earn|earning)\b/.test(text)
    && /\b(fear|afraid|scared|worried|risk|risky|risks|unsafe|uncertain)\b/.test(text)
  ) {
    return {
      surfaceProblem: 'money/risk decision',
      realCrux: 'growth versus security',
      activePlanets: ensurePlanets(activePlanets, ['Jupiter', 'Saturn', 'Moon', 'Venus']),
      dominantConflict,
      emotionalNeed: 'financial safety before expansion',
      recommendedPath: 'define the smallest affordable risk and pair it with a clear downside limit',
    }
  }

  if (
    /\b(purpose|meaning|identity|calling|direction|future self|who am i|becoming)\b/.test(text)
    && /\b(confused|confusion|unclear|unsure|uncertain|lost|not sure)\b/.test(text)
  ) {
    return {
      surfaceProblem: 'identity/purpose confusion',
      realCrux: 'self-expression versus certainty',
      activePlanets: ensurePlanets(activePlanets, ['Sun', 'Jupiter', 'Saturn', 'Mercury']),
      dominantConflict,
      emotionalNeed: 'a stable experiment before a final identity claim',
      recommendedPath: 'test one meaningful role for two weeks and observe what gives energy and integrity',
    }
  }

  return {
    surfaceProblem: inferSurfaceProblem(activation.matchedThemes),
    realCrux: dominantInteraction?.coreTension ?? 'clarity versus uncertainty',
    activePlanets,
    dominantConflict,
    emotionalNeed: dominantInteraction?.integrationPath ?? 'a named need and one grounded next step',
    recommendedPath: dominantInteraction
      ? `practice ${dominantInteraction.integrationPath} through one bounded action`
      : 'name the main concern and choose the smallest useful next step',
  }
}

function inferSurfaceProblem(matchedThemes: string[]): string {
  if (matchedThemes.length === 0) {
    return 'general reflection'
  }
  return matchedThemes.map((theme) => theme.toLowerCase()).join(' / ')
}

function ensurePlanets(current: PlanetName[], required: PlanetName[]): PlanetName[] {
  return [...new Set([...current, ...required])]
}
