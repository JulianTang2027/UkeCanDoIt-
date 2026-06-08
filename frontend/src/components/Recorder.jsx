import { useRecorder } from '../lib/useRecorder.js'
import { blobToWav } from '../lib/wav.js'

// Capture controls: record from the mic (converted to WAV) or upload an audio file.
export default function Recorder({ onAnalyze, busy }) {
  const { status, elapsed, error, start, stop } = useRecorder()

  const handleStop = async () => {
    const blob = await stop()
    if (!blob) return
    const wav = await blobToWav(blob)
    onAnalyze(wav, 'recording.wav')
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (file) onAnalyze(file, file.name)
    e.target.value = '' // let the same file be picked again
  }

  return (
    <div className="recorder">
      <div className="recorder__controls">
        {status === 'recording' ? (
          <button className="btn btn--stop" onClick={handleStop} disabled={busy}>
            <span className="btn__dot btn__dot--stop" /> Stop &amp; analyze
          </button>
        ) : (
          <button className="btn btn--primary" onClick={start} disabled={busy}>
            <span className="btn__dot" /> Record
          </button>
        )}

        <span className="recorder__or">or</span>

        <label className={`btn btn--ghost ${busy ? 'is-disabled' : ''}`}>
          Upload audio
          <input type="file" accept="audio/*" hidden onChange={handleFile} disabled={busy} />
        </label>
      </div>

      <div className="recorder__status">
        {status === 'recording' && (
          <span className="recording">
            <span className="recording__pulse" /> Recording… {elapsed.toFixed(1)}s
          </span>
        )}
        {busy && <span className="muted">Analyzing your take…</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  )
}
