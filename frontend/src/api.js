const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

/**
 * POST an audio file/blob to the backend's /analyze endpoint.
 * Returns the parsed JSON: { estimated_tempo_bpm, onset_times_seconds,
 * note_activity_over_time, chord_estimates, summary }.
 */
export async function analyzeAudio(file, filename = 'take.wav') {
  const form = new FormData()
  form.append('file', file, filename)

  let res
  try {
    res = await fetch(`${BASE}/analyze`, { method: 'POST', body: form })
  } catch {
    throw new Error(`Could not reach the analysis server at ${BASE}. Is the backend running?`)
  }

  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status}).`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* response had no JSON body */
    }
    throw new Error(detail)
  }

  return res.json()
}
