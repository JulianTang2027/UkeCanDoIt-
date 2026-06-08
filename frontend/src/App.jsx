import { useState } from 'react'
import Recorder from './components/Recorder.jsx'
import Results from './components/Results.jsx'
import { analyzeAudio } from './api.js'

export default function App() {
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const handleAnalyze = async (file, filename) => {
    setBusy(true)
    setError(null)
    setData(null)
    try {
      const result = await analyzeAudio(file, filename)
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <a className="brand" href="https://juliantang2027.github.io/UkeCanDoIt-/" target="_blank" rel="noopener">
          <span aria-hidden="true">🎸</span> Uke Can Do It<span className="accent">!</span>
        </a>
        <p className="tagline">
          Play a progression on your ukulele, then see your tempo, how many chords
          you played, and exactly what you played — in order.
        </p>
      </header>

      <main className="app__main">
        <Recorder onAnalyze={handleAnalyze} busy={busy} />
        {error && <p className="error error--block">{error}</p>}
        <Results data={data} />
      </main>

      <footer className="app__footer">EECS 352 · Uke Can Do It! · analyzed by the local API</footer>
    </div>
  )
}
