import { useState, useRef, useCallback, useEffect } from "react";
import * as Tone from "tone";
import ChordHighway from "./ChordHighway";
import { SONGS } from "./songs";

// Screens: "select" | "countdown" | "playing" | "analyzing" | "results"
// Add ?demo to URL to skip mic and use randomised results (useful without a backend)
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const LEAD_IN_BEATS = 4;

function getTag(score) {
  if (score >= 80) return { label: "Great job!", cls: "scorecard__tag--great" };
  if (score >= 55) return { label: "Keep practicing!", cls: "scorecard__tag--good" };
  return { label: "Keep at it!", cls: "scorecard__tag--try" };
}

function timingBadge(result) {
  if (!result || result.status === "missed") return { text: "Missed", cls: "miss" };
  const grade = result.timing_grade;
  if (!grade || grade === "miss") return { text: "No strum", cls: "miss" };
  const ms = result.timing_offset_ms;
  if (grade === "perfect" || ms == null) {
    return { text: grade[0].toUpperCase() + grade.slice(1), cls: grade };
  }
  // ◂ = early, ▸ = late
  return { text: `${ms < 0 ? "◂" : "▸"} ${Math.abs(ms)} ms`, cls: grade };
}

function ScoreBars({ chordPct, timingPct, cleanPct }) {
  return (
    <div className="score-bars">
      {[
        { name: "Chords",      val: chordPct },
        { name: "Timing",      val: timingPct },
        { name: "Cleanliness", val: cleanPct },
      ].map(({ name, val }) => (
        <div className="bar" key={name}>
          <span className="bar__name">{name}</span>
          <span className="bar__track">
            <span className="bar__fill" style={{ width: `${val}%` }} />
          </span>
          <span className="bar__val">{val}%</span>
        </div>
      ))}
    </div>
  );
}

function DebugPanel({ scoreData, results }) {
  const heardChords = scoreData.heard_chords ?? scoreData.debug?.heard_chords ?? results.map(r => r?.detected ?? null);
  const onsetTimes = scoreData.debug?.onset_times_seconds ?? [];

  return (
    <section className="debug-panel">
      <div className="debug-panel__header">
        <h3>Audio Debug</h3>
        <span>{scoreData.played_count ?? 0}/{results.length} heard</span>
      </div>

      <div className="debug-panel__stats">
        <span>Duration: {scoreData.recording_duration_seconds ?? "?"}s</span>
        <span>Score starts: {scoreData.start_offset_seconds ?? 0}s</span>
        <span>Onsets: {scoreData.scored_onset_count ?? scoreData.onset_count ?? onsetTimes.length}</span>
        <span>Matched: {scoreData.debug?.matched_slot_count ?? "?"}</span>
        <span>Extra: {scoreData.extra_onset_count ?? 0}</span>
      </div>

      <div className="debug-panel__sequence">
        <strong>Heard sequence</strong>
        <code>{heardChords.map(ch => ch ?? "-").join("  ")}</code>
      </div>

      <div className="debug-table" role="table" aria-label="Audio debug by chord slot">
        <div className="debug-table__row debug-table__row--head" role="row">
          <span>#</span>
          <span>Expected</span>
          <span>Heard</span>
          <span>Status</span>
          <span>Timing</span>
          <span>Conf.</span>
        </div>
        {results.map((r, i) => (
          <div className="debug-table__row" role="row" key={`${r?.expected ?? "slot"}-${i}`}>
            <span>{i + 1}</span>
            <span>{r?.expected ?? "-"}</span>
            <span>{r?.detected ?? "-"}</span>
            <span>{r?.status ?? "missed"}</span>
            <span>{r?.timing_offset_ms == null ? r?.timing_grade ?? "-" : `${r.timing_offset_ms} ms`}</span>
            <span>{r?.confidence ?? 0}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [screen, setScreen]       = useState("select");
  const [song, setSong]           = useState(SONGS[0]);
  const [countdown, setCountdown] = useState(null);
  const [leadInBeat, setLeadInBeat] = useState(null);
  const [currentChord, setCurrentChord] = useState(null);
  const [currentChordIdx, setCurrentChordIdx] = useState(-1);
  const [results, setResults]     = useState(null);
  const [scoreData, setScoreData] = useState(null);
  const [error, setError]         = useState(null);

  const mediaRecorderRef  = useRef(null);
  const audioChunksRef    = useRef([]);
  const countdownTimerRef = useRef(null);
  const metronomeRef      = useRef(null);

  // Cleanup Tone on unmount
  useEffect(() => () => {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    metronomeRef.current?.dispose();
  }, []);

  const stopTransport = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.seconds = 0;
    setLeadInBeat(null);
  }, []);

  // ---- STEP 1: user hits Play ----
  const handleStart = useCallback(async () => {
    await Tone.start();
    setError(null);
    setResults(null);
    setScoreData(null);
    setCurrentChord(null);
    setCurrentChordIdx(-1);
    setLeadInBeat(null);
    stopTransport();

    setScreen("countdown");
    let n = 3;
    setCountdown(n);

    countdownTimerRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countdownTimerRef.current);
        setCountdown(null);
        startPlaying();
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [song, stopTransport]);

  // ---- STEP 2: begin recording + transport ----
  const startPlaying = useCallback(async () => {
    if (!DEMO_MODE) {
      // Request mic
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone access denied — please allow mic access and try again.");
        setScreen("select");
        return;
      }

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
    }

    Tone.Transport.bpm.value = song.bpm;
    Tone.Transport.seconds = 0;

    if (!metronomeRef.current) {
      metronomeRef.current = new Tone.MembraneSynth({
        volume: -10,
        pitchDecay: 0.01,
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
      }).toDestination();
    }

    // Track which chord is active so the header shows it
    const secondsPerChord = (song.beatsPerChord * 60) / song.bpm;
    const beatSeconds = 60 / song.bpm;
    const leadInSeconds = LEAD_IN_BEATS * beatSeconds;
    const totalBeats = LEAD_IN_BEATS + song.chords.length * song.beatsPerChord;

    for (let beat = 0; beat < totalBeats; beat += 1) {
      const beatTime = beat * beatSeconds;
      Tone.Transport.schedule(time => {
        const isLeadIn = beat < LEAD_IN_BEATS;
        const isDownbeat = beat % song.beatsPerChord === 0;
        metronomeRef.current?.triggerAttackRelease(
          isDownbeat ? "C5" : "G4",
          "16n",
          time,
          isDownbeat ? 0.55 : 0.35
        );
        Tone.Draw.schedule(() => {
          if (isLeadIn) setLeadInBeat(beat + 1);
        }, time);
      }, beatTime);
    }

    song.chords.forEach((ch, i) => {
      Tone.Transport.schedule(time => {
        Tone.Draw.schedule(() => { setLeadInBeat(null); setCurrentChord(ch); setCurrentChordIdx(i); }, time);
      }, leadInSeconds + i * secondsPerChord);
    });

    // End of song
    const totalSeconds = leadInSeconds + song.chords.length * secondsPerChord;
    Tone.Transport.schedule(time => {
      Tone.Draw.schedule(() => finishRecording(), time);
    }, totalSeconds);

    setScreen("playing");
    setCurrentChord(null);
    setCurrentChordIdx(-1);
    setLeadInBeat(1);
    Tone.Transport.start();
  }, [song]);

  // ---- STEP 3: stop recording, send to backend ----
  const finishRecording = useCallback(async () => {
    stopTransport();
    setCurrentChord(null);
    setLeadInBeat(null);
    setScreen("analyzing");

    setCurrentChordIdx(-1);

    const mr = mediaRecorderRef.current;

    if (!DEMO_MODE && mr) {
      await new Promise(resolve => {
        mr.onstop = resolve;
        if (mr.state !== "inactive") mr.stop();
        else resolve();
      });
      mr.stream.getTracks().forEach(t => t.stop());
    }

    const makeDemo = () => {
      const demo = song.chords.map(() => {
        const r = Math.random();
        if (r <= 0.35) return { status: "missed", timing_grade: "miss", timing_offset_ms: null };
        const offset = Math.round((Math.random() - 0.5) * 500);
        const abs = Math.abs(offset);
        const grade = abs <= 90 ? "perfect" : abs <= 180 ? "good" : "ok";
        return {
          status: r > 0.65 ? "correct" : "wrong",
          timing_grade: grade,
          timing_offset_ms: offset,
        };
      });
      const pct = Math.round((demo.filter(d => d.status === "correct").length / demo.length) * 100);
      return { results: demo, pct };
    };

    if (DEMO_MODE) {
      await new Promise(r => setTimeout(r, 1200)); // simulate analysis delay
      const { results: demo, pct } = makeDemo();
      setResults(demo);
      setScoreData({ overall_score: pct, chord_accuracy_pct: pct,
        timing_accuracy_pct: Math.min(100, pct + 8), cleanliness_pct: Math.min(100, pct + 4) });
    } else {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const form = new FormData();
      form.append("file", blob, "performance.webm");
      form.append("chords", JSON.stringify(song.chords));
      form.append("bpm", String(song.bpm));
      form.append("beats_per_chord", String(song.beatsPerChord));
      form.append("start_offset_seconds", String((LEAD_IN_BEATS * 60) / song.bpm));

      try {
        const resp = await fetch("/score", { method: "POST", body: form });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.detail || "Analysis failed.");
        }
        const data = await resp.json();
        console.table(data.chord_results);
        console.log("Heard chords:", data.heard_chords ?? data.debug?.heard_chords);
        console.log("Audio debug:", data.debug);
        setResults(data.chord_results);
        setScoreData(data);
      } catch {
        const { results: demo, pct } = makeDemo();
        setResults(demo);
        setScoreData({ overall_score: pct, chord_accuracy_pct: pct,
          timing_accuracy_pct: Math.min(100, pct + 8), cleanliness_pct: Math.min(100, pct + 4) });
        setError("Backend not reachable — showing demo results.");
      }
    }

    setScreen("results");
  }, [song, stopTransport]);

  // Manual stop during play
  const handleStopEarly = useCallback(() => {
    clearInterval(countdownTimerRef.current);
    finishRecording();
  }, [finishRecording]);

  const handleReplay = useCallback(() => {
    setResults(null);
    setScoreData(null);
    setError(null);
    handleStart();
  }, [handleStart]);

  const handleBackToSelect = useCallback(() => {
    clearInterval(countdownTimerRef.current);
    stopTransport();
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") { mr.stop(); mr.stream?.getTracks().forEach(t => t.stop()); }
    setScreen("select");
    setResults(null);
    setScoreData(null);
    setError(null);
    setCurrentChord(null);
    setCountdown(null);
    setLeadInBeat(null);
  }, [stopTransport]);

  // ---- Render helpers ----
  const tag = scoreData ? getTag(scoreData.overall_score) : null;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__logo">
          🎸 Uke Can Do It<span className="accent">!</span>
        </div>
        <div className="app-header__meta">
          {screen === "playing" && (
            <>
              <span className="rec-dot" />
              <span>Recording</span>
            </>
          )}
          {screen === "results" && scoreData && (
            <span className="score-badge">{scoreData.overall_score}/100</span>
          )}
          {(screen === "playing" || screen === "countdown") && (
            <span>{song.bpm} BPM</span>
          )}
        </div>
      </header>

      <main className="app-main">
        {/* ---- Song select ---- */}
        {screen === "select" && (
          <div className="screen">
            <div className="select-screen">
              <h2>Pick a song</h2>
              <p>Choose a chord progression, then play along on your ukulele.</p>

              <ul className="song-list">
                {SONGS.map(s => (
                  <li key={s.id}>
                    <button
                      className={`song-card${song.id === s.id ? " is-selected" : ""}`}
                      onClick={() => setSong(s)}
                    >
                      <div className="song-card__info">
                        <strong>{s.name}</strong>
                        <span>{s.artist}</span>
                      </div>
                      <div className="song-card__meta">
                        <strong>{s.bpm} BPM</strong>
                        {s.chords.length} chords
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              {error && <div className="error-banner">{error}</div>}

              <div className="select-actions">
                <button className="btn btn--primary" onClick={handleStart}>
                  Play →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Countdown ---- */}
        {screen === "countdown" && (
          <div className="screen countdown-screen">
            <div className="countdown-number" key={countdown}>{countdown}</div>
            <div className="countdown-label">Get ready…</div>
          </div>
        )}

        {/* ---- Playing ---- */}
        {screen === "playing" && (
          <div className="screen playing-screen">
            <div className="playing-layout">
              <div className="playing-info">
                <div className="playing-info__song">
                  <strong>{song.name}</strong>
                  <span>{song.artist}</span>
                </div>
                <div className="playing-info__chord">
                  {leadInBeat ? `Lead-in ${leadInBeat}/${LEAD_IN_BEATS}` : currentChord ?? "—"}
                </div>
                <div className="playing-info__bpm">{song.bpm} BPM</div>
              </div>

              <div className="highway-area">
                <ChordHighway song={song} playing={true} results={null} leadInBeats={LEAD_IN_BEATS} />
              </div>

              {/* Progress bar */}
              <div className="progress-bar">
                <div
                  className="progress-bar__fill"
                  style={{
                    width: currentChordIdx >= 0
                      ? `${((currentChordIdx + 1) / song.chords.length) * 100}%`
                      : "0%",
                  }}
                />
              </div>

              {/* Up-next panel */}
              <div className="up-next">
                <div className="up-next__current">
                  <span className="up-next__label">Now</span>
                  <span className="up-next__chord">
                    {leadInBeat ? leadInBeat : currentChordIdx >= 0 ? song.chords[currentChordIdx] : "—"}
                  </span>
                </div>
                <div className="up-next__divider" />
                <div className="up-next__queue">
                  <span className="up-next__label">Up next</span>
                  <div className="up-next__chips">
                    {song.chords.slice(
                      Math.max(0, currentChordIdx + 1),
                      Math.max(0, currentChordIdx + 1) + 5
                    ).map((ch, i) => (
                      <span key={i} className="up-next__chip">{ch}</span>
                    ))}
                    {currentChordIdx + 1 >= song.chords.length && (
                      <span className="up-next__done">End of song</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="playing-controls">
                <div className="playing-controls__status">
                  <span className="rec-dot" />
                  Listening through your mic…
                </div>
                <button className="btn btn--danger btn--sm" onClick={handleStopEarly}>
                  Stop &amp; Analyze
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Analyzing ---- */}
        {screen === "analyzing" && (
          <div className="screen analyzing-screen">
            <div className="spinner" />
            <h2>Analyzing your performance…</h2>
            <p>Detecting onsets, chroma, and timing accuracy.</p>
          </div>
        )}

        {/* ---- Results ---- */}
        {screen === "results" && results && scoreData && (
          <div className="screen">
            <div className="results-screen">
              <div className="results-header">
                <h2>{song.name}</h2>
                <p>{song.artist} · {song.bpm} BPM</p>
              </div>

              <div className="scorecard">
                <div className="scorecard__top">
                  <div>
                    <div className="scorecard__label">Overall score</div>
                    <div className="scorecard__score-num">
                      {scoreData.overall_score}<span>/100</span>
                    </div>
                  </div>
                  <div className={`scorecard__tag ${tag.cls}`}>{tag.label}</div>
                </div>

                <div className="chord-chips">
                  {song.chords.map((ch, i) => {
                    const r = results[i];
                    const st = r?.status ?? "missed";
                    const badge = timingBadge(r);
                    return (
                      <span key={i} className={`chip chip--${st}`}>
                        <span>{ch}</span>
                        {r?.detected && r.detected !== ch && (
                          <small className="chip__heard">heard {r.detected}</small>
                        )}
                        <small className={`chip__timing chip__timing--${badge.cls}`}>
                          {badge.text}
                        </small>
                      </span>
                    );
                  })}
                </div>

                <ul className="results-legend">
                  <li><span className="legend-dot legend-dot--correct" /> Correct chord</li>
                  <li><span className="legend-dot legend-dot--wrong" /> Wrong chord</li>
                  <li><span className="legend-dot legend-dot--missed" /> Missed strum</li>
                  <li className="results-legend__hint">◂ early · ▸ late</li>
                </ul>

                <ScoreBars
                  chordPct={scoreData.chord_accuracy_pct ?? scoreData.overall_score}
                  timingPct={scoreData.timing_accuracy_pct ?? Math.min(100, scoreData.overall_score + 8)}
                  cleanPct={scoreData.cleanliness_pct ?? Math.min(100, scoreData.overall_score + 4)}
                />
              </div>

              <DebugPanel scoreData={scoreData} results={results} />

              {error && <div className="error-banner">{error}</div>}

              <div className="results-actions">
                <button className="btn btn--ghost" onClick={handleBackToSelect}>← Change song</button>
                <button className="btn btn--primary" onClick={handleReplay}>Try again</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
