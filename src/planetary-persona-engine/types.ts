export type PlanetName =
  | 'Sun'
  | 'Moon'
  | 'Mercury'
  | 'Venus'
  | 'Mars'
  | 'Jupiter'
  | 'Saturn'

export type InteractionType =
  | 'conflict'
  | 'support'
  | 'suppression'
  | 'translation'

export interface PlanetAgent {
  planet: PlanetName
  agentName: string
  coreDrive: string
  strength: string
  shadow: string
  trigger: string
  decisionBias: string
  growthPath: string
  baseWeight: number
}

export interface PlanetActivation {
  planet: PlanetName
  score: number
  reason: string
}

export interface PlanetInteraction {
  fromPlanet: PlanetName
  toPlanet: PlanetName
  interactionType: InteractionType
  coreTension: string
  behaviorPattern: string
  shadowPattern: string
  integrationPath: string
  strength: number
}

export interface ActivationResult {
  activePlanets: PlanetActivation[]
  inactivePlanets: PlanetName[]
  matchedThemes: string[]
}

export interface CruxResult {
  surfaceProblem: string
  realCrux: string
  activePlanets: PlanetName[]
  dominantConflict: string
  emotionalNeed: string
  recommendedPath: string
}

export interface MemoryCandidate {
  type: string
  pattern: string
  relatedPlanets: PlanetName[]
  evidence: string
  confidence: number
}

export interface ReflectionResult {
  activePlanets: PlanetName[]
  dominantTension: string
  userState: string
  lesson: string
  memoryCandidates: MemoryCandidate[]
  shouldStoreMemory: boolean
}

export interface LLMAdapter {
  generateResponse(prompt: string): Promise<string>
}

export interface PersonalityAnalysisInput {
  text: string
  memoryCandidates?: MemoryCandidate[]
  llmAdapter?: LLMAdapter
  metadata?: Record<string, unknown>
}

export interface PersonalityInternalState {
  agents: PlanetAgent[]
  activation: ActivationResult
  interactions: PlanetInteraction[]
  dominantInteraction: PlanetInteraction | null
  crux: CruxResult
  memoryCandidates: MemoryCandidate[]
}

export interface PersonalityPromptState extends PersonalityInternalState {
  input: PersonalityAnalysisInput
}

export interface PersonalityAnalysisResult {
  response: string
  activePlanets: PlanetActivation[]
  interactions: PlanetInteraction[]
  dominantInteraction: PlanetInteraction | null
  crux: CruxResult
  reflection: ReflectionResult
  memoryCandidates: MemoryCandidate[]
}
