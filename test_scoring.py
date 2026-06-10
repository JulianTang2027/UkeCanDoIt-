"""Sanity checks for score_performance using synthesized chord audio.

Run with: .venv\\Scripts\\python.exe test_scoring.py
Builds WAVs of decaying chord triads at known strum times (60 BPM, 2 beats
per chord -> one slot every 2s) and checks grades, offsets, and penalties.
"""
from __future__ import annotations

import tempfile
import os

import numpy as np
import soundfile as sf

from audio_analysis import score_performance

SR = 22050
NOTE_FREQS = {
    "C": [261.63, 329.63, 392.00],   # C E G
    "G": [392.00, 493.88, 587.33],   # G B D
    "F": [349.23, 440.00, 523.25],   # F A C
    "Am": [440.00, 523.25, 659.25],  # A C E
}


def render(strums: list[tuple[float, str]], duration: float) -> np.ndarray:
    y = np.zeros(int(duration * SR))
    for time, chord in strums:
        n = int(0.9 * SR)
        t = np.arange(n) / SR
        env = np.exp(-3.5 * t)
        fade = int(0.15 * SR)  # taper the tail so the cutoff isn't a phantom onset
        env[-fade:] *= np.linspace(1.0, 0.0, fade)
        tone = sum(np.sin(2 * np.pi * f * t) for f in NOTE_FREQS[chord]) * env
        start = int(time * SR)
        y[start:start + n] += tone[: max(0, y.size - start)]
    peak = np.max(np.abs(y))
    return y / peak * 0.8 if peak > 0 else y


def score(strums, duration, chords):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        path = f.name
    try:
        sf.write(path, render(strums, duration), SR)
        return score_performance(path, expected_chords=chords, bpm=60.0, beats_per_chord=2)
    finally:
        os.remove(path)


def main():
    chords = ["C", "G", "F", "Am"]

    # 1. On-time, correct chords at every slot (0, 2, 4, 6 s).
    r = score([(0.05, "C"), (2.0, "G"), (4.0, "F"), (6.0, "Am")], 8.5, chords)
    grades = [c["timing_grade"] for c in r["chord_results"]]
    statuses = [c["status"] for c in r["chord_results"]]
    print("perfect run:", r["overall_score"], grades, statuses,
          [c["detected"] for c in r["chord_results"]])
    assert all(s == "correct" for s in statuses), statuses
    assert r["timing_accuracy_pct"] >= 85, r["timing_accuracy_pct"]
    assert r["overall_score"] >= 80, r["overall_score"]

    # 2. Slot 1 strummed 300 ms late -> "ok" grade, positive offset.
    r = score([(0.05, "C"), (2.3, "G"), (4.0, "F"), (6.0, "Am")], 8.5, chords)
    late = r["chord_results"][1]
    print("late strum:", late["timing_grade"], late["timing_offset_ms"])
    assert late["timing_grade"] == "ok", late
    assert late["timing_offset_ms"] and late["timing_offset_ms"] > 200, late

    # 3. Slot 2 silent -> missed.
    r = score([(0.05, "C"), (2.0, "G"), (6.0, "Am")], 8.5, chords)
    missed = r["chord_results"][2]
    print("missed slot:", missed["status"], missed["timing_grade"])
    assert missed["status"] == "missed", missed
    assert missed["timing_grade"] == "miss", missed

    # 4. Wrong chord in slot 1 (played C instead of G) -> wrong, accuracy drops.
    r = score([(0.05, "C"), (2.0, "C"), (4.0, "F"), (6.0, "Am")], 8.5, chords)
    wrong = r["chord_results"][1]
    print("wrong chord:", wrong["status"], wrong["detected"])
    assert wrong["status"] == "wrong", wrong
    assert r["chord_accuracy_pct"] == 75, r["chord_accuracy_pct"]

    # 5. Extra strums between slots -> counted and cleanliness penalized.
    clean = score([(0.05, "C"), (2.0, "G"), (4.0, "F"), (6.0, "Am")], 8.5, chords)
    noisy = score([(0.05, "C"), (1.0, "C"), (2.0, "G"), (3.0, "G"), (4.0, "F"),
                   (5.0, "F"), (6.0, "Am")], 8.5, chords)
    print("extra onsets:", noisy["extra_onset_count"],
          "cleanliness", clean["cleanliness_pct"], "->", noisy["cleanliness_pct"])
    assert noisy["extra_onset_count"] >= 2, noisy["extra_onset_count"]
    assert noisy["cleanliness_pct"] < clean["cleanliness_pct"], (
        clean["cleanliness_pct"], noisy["cleanliness_pct"])

    print("All scoring checks passed.")


if __name__ == "__main__":
    main()
