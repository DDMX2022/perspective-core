import type {
  PersonalityAnalysisInput,
  PersonalityInternalState,
  ReflectionResult,
} from './types.js'

export function reflectOnInteraction(
  input: PersonalityAnalysisInput,
  internalState: PersonalityInternalState,
  response: string,
): ReflectionResult {
  const dominantTension =
    internalState.dominantInteraction?.coreTension ?? internalState.crux.realCrux
  const memoryCandidates = internalState.memoryCandidates
  const shouldStoreMemory = memoryCandidates.some((candidate) => candidate.confidence >= 0.7)

  return {
    activePlanets: internalState.crux.activePlanets,
    dominantTension,
    userState: inferUserState(internalState.crux.realCrux),
    lesson: inferLesson(internalState, response, input.text),
    memoryCandidates,
    shouldStoreMemory,
  }
}

function inferUserState(realCrux: string): string {
  const states: Record<string, string> = {
    'expansion versus safety': 'considering expansion while seeking emotional and practical safety',
    'action versus fear/resistance': 'ready enough to act but caught in resistance or pressure',
    'emotion versus communication/value clarity': 'seeking relational clarity while sorting emotion and values',
    'impulse versus boundary': 'holding strong charge while trying to prevent harm',
    'growth versus security': 'wanting financial growth while protecting security',
    'self-expression versus certainty': 'searching for identity clarity before committing fully',
  }

  return states[realCrux] ?? 'working through a symbolic tension that needs a grounded next step'
}

function inferLesson(
  internalState: PersonalityInternalState,
  response: string,
  inputText: string,
): string {
  if (internalState.crux.realCrux === 'expansion versus safety') {
    return 'A full leap is not required first; the lesson is to convert fear into a controlled validation plan.'
  }
  if (internalState.crux.realCrux === 'impulse versus boundary') {
    return 'The useful move is to separate raw charge from harmful action, then express the boundary clearly.'
  }
  if (response.includes(internalState.crux.recommendedPath)) {
    return `The response kept the symbolic analysis actionable for "${inputText}".`
  }
  return `The structured reflection identified ${internalState.crux.realCrux} and proposed ${internalState.crux.recommendedPath}.`
}
