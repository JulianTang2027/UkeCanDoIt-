import ChordTimeline from './ChordTimeline.jsx'

export default function Results({ data }) {
  if (!data) return null

  const chordCount = data.chord_estimates?.length ?? 0
  const strumCount = data.onset_times_seconds?.length ?? 0

  return (
    <section className="results">
      <div className="stats">
        <Stat value={data.estimated_tempo_bpm ?? '—'} unit="BPM" label="Estimated tempo" />
        <Stat value={chordCount} label="Chords detected" />
        <Stat value={strumCount} label="Strums" />
      </div>

      {data.summary && <p className="summary">{data.summary}</p>}

      <h2 className="results__heading">Chords, in order</h2>
      <ChordTimeline chords={data.chord_estimates} />
    </section>
  )
}

function Stat({ value, unit, label }) {
  return (
    <div className="stat">
      <p className="stat__value">
        {value}
        {unit && <span className="stat__unit"> {unit}</span>}
      </p>
      <p className="stat__label">{label}</p>
    </div>
  )
}
