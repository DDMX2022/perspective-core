import http from 'node:http'
import { URL } from 'node:url'
import { analyzePersonality } from '../src/planetary-persona-engine/index.js'

const DEFAULT_PORT = Number(process.env['PORT'] ?? 4321)
const HOST = process.env['HOST'] ?? '127.0.0.1'

const SAMPLE_PROMPTS = [
  'I want to start my business but I am scared.',
  'I keep procrastinating even though I know what to do.',
  'I am confused about my relationship.',
  'I am angry but I do not want to hurt anyone.',
  'I want more money but I am afraid of taking risks.',
]

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${DEFAULT_PORT}`}`)

  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(res, renderPage())
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, { ok: true })
    return
  }

  if (req.method === 'POST' && url.pathname === '/personality/analyze') {
    try {
      const body = await readJsonBody(req)
      const text = typeof body['text'] === 'string' ? body['text'].trim() : ''

      if (!text) {
        sendJson(res, { error: 'Text is required.' }, 400)
        return
      }

      const result = await analyzePersonality({ text })
      sendJson(res, result)
    } catch (error) {
      sendJson(
        res,
        {
          error: error instanceof Error ? error.message : 'Unexpected debug server error.',
        },
        500,
      )
    }
    return
  }

  sendJson(res, { error: 'Not found.' }, 404)
})

listen(DEFAULT_PORT)

function listen(port: number): void {
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      listen(port + 1)
      return
    }

    throw error
  })

  server.listen(port, HOST, () => {
    console.log(`Planetary Persona Engine debug UI: http://${HOST}:${port}`)
  })
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) {
    return {}
  }

  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  return parsed as Record<string, unknown>
}

function sendJson(res: http.ServerResponse, payload: unknown, status = 200): void {
  const json = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(json)
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(html)
}

function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Planetary Persona Engine Debug</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1f2933;
      --muted: #627386;
      --line: #d9e2ec;
      --panel: #ffffff;
      --page: #f4f7f9;
      --accent: #1b7f79;
      --accent-strong: #12645f;
      --warn: #a15c14;
      --soft: #eef7f6;
      --code: #17212b;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--page);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button,
    textarea {
      font: inherit;
    }

    .shell {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: 24px;
    }

    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: clamp(1.4rem, 2vw, 2.1rem);
      line-height: 1.1;
      letter-spacing: 0;
    }

    .subtitle {
      margin: 0;
      color: var(--muted);
      max-width: 760px;
    }

    .badge {
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--panel);
      color: var(--muted);
      font-size: 0.9rem;
      white-space: nowrap;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding: 12px 14px;
      min-height: 48px;
    }

    h2 {
      margin: 0;
      font-size: 0.95rem;
      letter-spacing: 0;
    }

    .panel-body {
      padding: 14px;
    }

    textarea {
      width: 100%;
      min-height: 180px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      color: var(--ink);
      background: #fff;
      line-height: 1.45;
    }

    textarea:focus,
    button:focus-visible {
      outline: 3px solid rgba(27, 127, 121, 0.25);
      outline-offset: 2px;
    }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
      align-items: center;
    }

    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      min-height: 38px;
      padding: 8px 11px;
      cursor: pointer;
    }

    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
      font-weight: 650;
    }

    button.primary:hover {
      background: var(--accent-strong);
    }

    button:disabled {
      cursor: progress;
      opacity: 0.75;
    }

    .sample-list {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }

    .sample-list button {
      text-align: left;
      line-height: 1.3;
      min-height: 42px;
    }

    .status {
      color: var(--muted);
      font-size: 0.9rem;
    }

    .results {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .wide {
      grid-column: 1 / -1;
    }

    .response {
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .stack {
      display: grid;
      gap: 10px;
    }

    .planet {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: var(--soft);
    }

    .planet-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
      font-weight: 700;
    }

    .reason {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.35;
    }

    .kv {
      display: grid;
      grid-template-columns: 145px minmax(0, 1fr);
      gap: 8px 12px;
      align-items: start;
      line-height: 1.35;
    }

    .kv dt {
      color: var(--muted);
      font-weight: 700;
    }

    .kv dd {
      margin: 0;
      min-width: 0;
    }

    pre {
      margin: 0;
      max-height: 430px;
      overflow: auto;
      border-radius: 8px;
      background: var(--code);
      color: #d8e6f3;
      padding: 12px;
      line-height: 1.45;
      font-size: 0.86rem;
    }

    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 18px;
      background: #fff;
    }

    .error {
      color: var(--warn);
      font-weight: 700;
    }

    @media (max-width: 980px) {
      .layout,
      .results {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .shell {
        padding: 14px;
      }

      header {
        align-items: stretch;
        flex-direction: column;
      }

      .badge {
        white-space: normal;
      }

      .actions {
        flex-direction: column;
        align-items: stretch;
      }

      .kv {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>Planetary Persona Engine Debug</h1>
        <p class="subtitle">A local tester for the symbolic personality engine, crux extraction, memory candidates, and structured reflection.</p>
      </div>
      <div class="badge">Safe framing: simulated reflective self-model</div>
    </header>

    <div class="layout">
      <section class="panel">
        <div class="panel-header">
          <h2>User Input</h2>
        </div>
        <div class="panel-body">
          <textarea id="input" aria-label="User input">${escapeHtml(SAMPLE_PROMPTS[0])}</textarea>
          <div class="actions">
            <button id="analyze" class="primary" type="button">Analyze</button>
            <button id="clear" type="button">Clear</button>
            <span id="status" class="status">Ready</span>
          </div>
          <div class="sample-list" aria-label="Sample prompts">
            ${SAMPLE_PROMPTS.map((prompt) => `<button type="button" data-sample="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}
          </div>
        </div>
      </section>

      <section class="results">
        <article class="panel wide">
          <div class="panel-header">
            <h2>Response</h2>
          </div>
          <div class="panel-body">
            <div id="response" class="empty">Run an analysis to see the generated response.</div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Active Planets</h2>
          </div>
          <div class="panel-body">
            <div id="activePlanets" class="empty">No analysis yet.</div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Dominant Interaction</h2>
          </div>
          <div class="panel-body">
            <div id="dominantInteraction" class="empty">No analysis yet.</div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Crux</h2>
          </div>
          <div class="panel-body">
            <div id="crux" class="empty">No analysis yet.</div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Reflection</h2>
          </div>
          <div class="panel-body">
            <div id="reflection" class="empty">No analysis yet.</div>
          </div>
        </article>

        <article class="panel wide">
          <div class="panel-header">
            <h2>Memory Candidates</h2>
          </div>
          <div class="panel-body">
            <pre id="memoryCandidates">[]</pre>
          </div>
        </article>

        <article class="panel wide">
          <div class="panel-header">
            <h2>Raw Result</h2>
          </div>
          <div class="panel-body">
            <pre id="rawResult">{}</pre>
          </div>
        </article>
      </section>
    </div>
  </main>

  <script>
    const input = document.querySelector('#input')
    const analyzeButton = document.querySelector('#analyze')
    const clearButton = document.querySelector('#clear')
    const statusEl = document.querySelector('#status')

    const responseEl = document.querySelector('#response')
    const activePlanetsEl = document.querySelector('#activePlanets')
    const dominantInteractionEl = document.querySelector('#dominantInteraction')
    const cruxEl = document.querySelector('#crux')
    const reflectionEl = document.querySelector('#reflection')
    const memoryCandidatesEl = document.querySelector('#memoryCandidates')
    const rawResultEl = document.querySelector('#rawResult')

    document.querySelectorAll('[data-sample]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.sample
        analyze()
      })
    })

    analyzeButton.addEventListener('click', analyze)
    clearButton.addEventListener('click', () => {
      input.value = ''
      input.focus()
    })

    async function analyze() {
      const text = input.value.trim()
      if (!text) {
        statusEl.textContent = 'Enter text first'
        return
      }

      analyzeButton.disabled = true
      statusEl.textContent = 'Analyzing...'

      try {
        const response = await fetch('/personality/analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Analysis failed')
        }

        renderResult(result)
        statusEl.textContent = 'Done'
      } catch (error) {
        statusEl.textContent = 'Error'
        responseEl.className = 'error'
        responseEl.textContent = error instanceof Error ? error.message : 'Unexpected error'
      } finally {
        analyzeButton.disabled = false
      }
    }

    function renderResult(result) {
      responseEl.className = 'response'
      responseEl.textContent = result.response || ''

      activePlanetsEl.className = 'stack'
      activePlanetsEl.innerHTML = (result.activePlanets || []).map((planet) => (
        '<div class="planet">' +
          '<div class="planet-top"><span>' + escapeHtml(planet.planet) + '</span><span>' + escapeHtml(String(planet.score)) + '</span></div>' +
          '<div class="reason">' + escapeHtml(planet.reason) + '</div>' +
        '</div>'
      )).join('') || '<div class="empty">No active planets.</div>'

      dominantInteractionEl.className = ''
      dominantInteractionEl.innerHTML = result.dominantInteraction
        ? renderKv({
            Pair: result.dominantInteraction.fromPlanet + '-' + result.dominantInteraction.toPlanet,
            Type: result.dominantInteraction.interactionType,
            Tension: result.dominantInteraction.coreTension,
            Pattern: result.dominantInteraction.behaviorPattern,
            Shadow: result.dominantInteraction.shadowPattern,
            Integration: result.dominantInteraction.integrationPath,
            Strength: result.dominantInteraction.strength,
          })
        : '<div class="empty">No dominant interaction.</div>'

      cruxEl.className = ''
      cruxEl.innerHTML = renderKv({
        Surface: result.crux?.surfaceProblem,
        'Real Crux': result.crux?.realCrux,
        Conflict: result.crux?.dominantConflict,
        Need: result.crux?.emotionalNeed,
        Path: result.crux?.recommendedPath,
      })

      reflectionEl.className = ''
      reflectionEl.innerHTML = renderKv({
        Tension: result.reflection?.dominantTension,
        'User State': result.reflection?.userState,
        Lesson: result.reflection?.lesson,
        'Store Memory': result.reflection?.shouldStoreMemory,
      })

      memoryCandidatesEl.textContent = JSON.stringify(result.memoryCandidates || [], null, 2)
      rawResultEl.textContent = JSON.stringify(result, null, 2)
    }

    function renderKv(values) {
      return '<dl class="kv">' + Object.entries(values).map(([key, value]) => (
        '<dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(formatValue(value)) + '</dd>'
      )).join('') + '</dl>'
    }

    function formatValue(value) {
      if (Array.isArray(value)) return value.join(', ')
      if (value === undefined || value === null || value === '') return 'none'
      return String(value)
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
    }
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
