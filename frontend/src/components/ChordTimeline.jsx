// Renders chord_estimates in time order. Each chip shows the chord name, a
// confidence bar (the "rating"), and the window start time.
export default function ChordTimeline({ chords }) {
  if (!chords?.length) {
    return <p className="muted">No chords detected in this take.</p>
  }

  return (
    <ol className="timeline">
      {chords.map((c, i) => {
        const pct = Math.round((c.confidence ?? 0) * 100)
        return (
          <li key={i} className="chord">
            <span className="chord__index">{i + 1}</span>
            <span className="chord__name">{c.chord}</span>
            <span className="chord__bar" title={`Confidence ${pct}%`}>
              <span className="chord__fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="chord__conf">{pct}%</span>
            <span className="chord__time">{Number(c.start).toFixed(2)}s</span>
          </li>
        )
      })}
    </ol>
  )
}
