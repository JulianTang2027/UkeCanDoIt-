import { useEffect, useRef } from "react";
import * as Tone from "tone";
import "./ChordHighway.css";

// Pixels that one beat occupies on screen
const PX_PER_BEAT = 140;
// Gap between chord blocks in px
const CHORD_GAP = 16;
// Fraction of container width where the hit line sits
const HIT_X_RATIO = 0.22;

const STATUS_STYLE = {
  pending: { bg: "rgba(255,255,255,0.06)", bd: "rgba(255,255,255,0.14)", fg: "#f5f5f4" },
  active:  { bg: "rgba(244,162,89,0.20)",  bd: "#f4a259",                fg: "#f4a259" },
  correct: { bg: "rgba(74,222,128,0.15)",  bd: "#4ade80",                fg: "#4ade80" },
  wrong:   { bg: "rgba(255,107,74,0.15)",  bd: "#ff6b4a",                fg: "#ff6b4a" },
  missed:  { bg: "rgba(255,255,255,0.02)", bd: "rgba(255,255,255,0.06)", fg: "#3a3a40" },
};

function paintBlock(el, status) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  el.style.background = s.bg;
  el.style.borderColor = s.bd;
  el.querySelector("strong").style.color = s.fg;
  // glow
  if (status === "active") {
    el.style.boxShadow = "0 0 20px rgba(244,162,89,0.35), inset 0 0 10px rgba(244,162,89,0.1)";
  } else if (status === "correct") {
    el.style.boxShadow = "0 0 16px rgba(74,222,128,0.3)";
  } else if (status === "wrong") {
    el.style.boxShadow = "0 0 16px rgba(255,107,74,0.3)";
  } else {
    el.style.boxShadow = "none";
  }
  el.dataset.status = status;
}

// playing  — Tone.Transport is running, animate chords rightward → leftward
// results  — song finished, results array paints each block
// idle/other — static preview, chords parked off-screen right
export default function ChordHighway({ song, playing, results }) {
  const wrapRef  = useRef(null);
  const blockRefs = useRef([]);
  const rafRef   = useRef(null);

  const chordW = song.beatsPerChord * PX_PER_BEAT - CHORD_GAP;
  const speed  = PX_PER_BEAT * (song.bpm / 60); // px per second

  // Paint results colours once analysis returns
  useEffect(() => {
    if (!results) return;
    blockRefs.current.forEach((el, i) => {
      if (!el) return;
      paintBlock(el, results[i]?.status ?? "missed");
      // Park finished chords in a static left-to-right layout so they're readable
      const hitX = (wrapRef.current?.clientWidth ?? 800) * HIT_X_RATIO;
      const cx = hitX + (i - (results.length - 1) / 2) * (chordW + CHORD_GAP + 4);
      el.style.transform = `translateX(${cx - chordW / 2}px)`;
    });
  }, [results, chordW]);

  // Animation loop — only while playing
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    // Reset all blocks to pending before starting
    blockRefs.current.forEach(el => { if (el) paintBlock(el, "pending"); });

    function tick() {
      const wrap = wrapRef.current;
      if (!wrap) { rafRef.current = requestAnimationFrame(tick); return; }

      const hitX    = wrap.clientWidth * HIT_X_RATIO;
      const elapsed = Tone.Transport.seconds;

      blockRefs.current.forEach((el, i) => {
        if (!el) return;

        // Time at which this chord should cross the hit line
        const tHit = (i * song.beatsPerChord * 60) / song.bpm;
        // Center x of this block right now
        const cx = hitX + speed * (tHit - elapsed);

        el.style.transform = `translateX(${cx - chordW / 2}px)`;

        // Determine live visual state (only while no scored results yet)
        const inside = Math.abs(cx - hitX) < chordW / 2 + 2;
        const past   = cx + chordW / 2 < hitX - 8;
        const next   = inside ? "active" : past ? "missed" : "pending";

        if (el.dataset.status !== next) paintBlock(el, next);
      });

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, song, speed, chordW]);

  return (
    <div className={`highway${playing ? "" : " highway--idle"}`} ref={wrapRef}>
      {/* Hit zone vertical line */}
      <div
        className="highway__hit-line"
        style={{ left: `${HIT_X_RATIO * 100}%` }}
      />
      <div
        className="highway__hit-label"
        style={{ left: `${HIT_X_RATIO * 100}%` }}
      >
        STRUM
      </div>

      {/* Chord blocks — positioned via JS transform */}
      <div className="highway__track">
        {song.chords.map((ch, i) => (
          <div
            key={`${song.id}-${i}`}
            ref={el => { blockRefs.current[i] = el; }}
            className="chord-block"
            style={{
              width: chordW,
              // park off-screen right before animation starts
              transform: `translateX(${(wrapRef.current?.clientWidth ?? 900) + i * (chordW + CHORD_GAP)}px)`,
            }}
            data-status="pending"
          >
            <strong>{ch}</strong>
            <small>{i + 1}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
