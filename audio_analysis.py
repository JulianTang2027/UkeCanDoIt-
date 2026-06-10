from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

import librosa
import numpy as np


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_TO_SHARP = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}


def _major_triad(root: str) -> list[str]:
    i = NOTE_NAMES.index(root)
    return [NOTE_NAMES[i], NOTE_NAMES[(i + 4) % 12], NOTE_NAMES[(i + 7) % 12]]


def _minor_triad(root: str) -> list[str]:
    i = NOTE_NAMES.index(root)
    return [NOTE_NAMES[i], NOTE_NAMES[(i + 3) % 12], NOTE_NAMES[(i + 7) % 12]]


CHORD_TONES: dict[str, list[str]] = {root: _major_triad(root) for root in NOTE_NAMES}
CHORD_TONES.update({f"{root}m": _minor_triad(root) for root in NOTE_NAMES})


class AudioAnalysisError(ValueError):
    """Raised when an audio file cannot be analyzed."""


@dataclass(frozen=True)
class TimeWindow:
    start: float
    end: float


def analyze_audio_file(path: str) -> dict[str, Any]:
    """Load an audio file and return simple onset, tempo, note, and chord estimates."""
    y, sr = load_audio(path)
    onset_times = detect_onsets(y, sr)
    tempo = estimate_tempo(y, sr)
    chroma = extract_chroma(y, sr)
    chroma_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr)
    duration = float(librosa.get_duration(y=y, sr=sr))
    windows = build_analysis_windows(onset_times, duration)

    note_activity = []
    chord_estimates = []

    for window in windows:
        window_chroma = average_chroma_for_window(chroma, chroma_times, window)
        top_notes = estimate_top_notes(window_chroma)
        chord_name, confidence = estimate_chord(window_chroma)

        note_activity.append(
            {
                "start": round(window.start, 3),
                "end": round(window.end, 3),
                "top_notes": top_notes,
            }
        )
        chord_estimates.append(
            {
                "start": round(window.start, 3),
                "end": round(window.end, 3),
                "chord": chord_name,
                "confidence": round(confidence, 3),
            }
        )

    rounded_tempo = round(float(tempo), 1)
    rounded_onsets = [round(float(t), 3) for t in onset_times]

    return {
        "estimated_tempo_bpm": rounded_tempo,
        "onset_times_seconds": rounded_onsets,
        "note_activity_over_time": note_activity,
        "chord_estimates": chord_estimates,
        "summary": build_summary(rounded_tempo, rounded_onsets, chord_estimates),
    }


def load_audio(path: str) -> tuple[np.ndarray, int]:
    try:
        # 22.05kHz is plenty for chord/onset detection and is ~2x faster than
        # MediaRecorder's native 48kHz.
        y, sr = librosa.load(path, sr=22050, mono=True)
    except Exception as exc:
        raise AudioAnalysisError(
            "Could not decode the recording. Browser recordings are .webm/opus, "
            "which librosa needs ffmpeg to decode on Windows — make sure ffmpeg "
            f"is installed and on PATH. Underlying error: {exc!r}"
        ) from exc

    if y.size == 0:
        raise AudioAnalysisError("The uploaded audio file is empty.")

    if not np.isfinite(y).all():
        raise AudioAnalysisError("The uploaded audio file contains invalid sample data.")

    if float(np.max(np.abs(y))) < 1e-5:
        raise AudioAnalysisError("The uploaded audio file appears to be silent.")

    return y, sr


def detect_onsets(y: np.ndarray, sr: int) -> list[float]:
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames", backtrack=True)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)
    return [float(t) for t in onset_times]


def estimate_tempo(y: np.ndarray, sr: int) -> float:
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return float(np.asarray(tempo).reshape(-1)[0])


def extract_chroma(y: np.ndarray, sr: int) -> np.ndarray:
    try:
        return librosa.feature.chroma_cqt(y=y, sr=sr)
    except Exception:
        return librosa.feature.chroma_stft(y=y, sr=sr)


def build_analysis_windows(onset_times: list[float], duration: float) -> list[TimeWindow]:
    min_window_seconds = 0.1

    if duration <= 0:
        raise AudioAnalysisError("The uploaded audio file has no measurable duration.")

    if len(onset_times) >= 2:
        boundaries = [t for t in onset_times if 0 <= t < duration]
        windows = [
            TimeWindow(start=boundaries[i], end=boundaries[i + 1])
            for i in range(len(boundaries) - 1)
            if boundaries[i + 1] - boundaries[i] >= min_window_seconds
        ]
        if boundaries and duration - boundaries[-1] >= min_window_seconds:
            windows.append(TimeWindow(start=boundaries[-1], end=duration))
        if windows:
            return windows

    starts = np.arange(0.0, duration, 1.0)
    return [TimeWindow(start=float(start), end=float(min(start + 1.0, duration))) for start in starts]


def average_chroma_for_window(
    chroma: np.ndarray, chroma_times: np.ndarray, window: TimeWindow
) -> np.ndarray:
    mask = (chroma_times >= window.start) & (chroma_times < window.end)
    if not np.any(mask):
        closest_frame = int(np.argmin(np.abs(chroma_times - window.start)))
        return chroma[:, closest_frame]
    return np.mean(chroma[:, mask], axis=1)


def estimate_top_notes(chroma_vector: np.ndarray, count: int = 3) -> list[str]:
    if float(np.linalg.norm(chroma_vector)) == 0.0:
        return []

    top_indexes = np.argsort(chroma_vector)[::-1][:count]
    return [NOTE_NAMES[int(index)] for index in top_indexes]


def estimate_chord(chroma_vector: np.ndarray) -> tuple[str, float]:
    chord, score, _ = estimate_chord_with_margin(chroma_vector)
    return chord, score


def estimate_chord_with_margin(chroma_vector: np.ndarray) -> tuple[str, float, float]:
    """Best chord match plus the margin over the runner-up template.

    The margin (best - second best) is a cleanliness signal: a cleanly fretted
    chord matches its template far better than any other, while a muted or
    buzzing strum matches several templates about equally.
    """
    normalized_chroma = normalize(chroma_vector)
    if float(np.linalg.norm(normalized_chroma)) == 0.0:
        return "Unknown", 0.0, 0.0

    best_chord = "Unknown"
    best_score = 0.0
    second_score = 0.0

    for chord_name, tones in CHORD_TONES.items():
        template = chord_template(tones)
        score = float(np.dot(normalized_chroma, normalize(template)))
        if score > best_score:
            second_score = best_score
            best_chord = chord_name
            best_score = score
        elif score > second_score:
            second_score = score

    return best_chord, best_score, best_score - second_score


def chord_template(tones: list[str]) -> np.ndarray:
    template = np.zeros(12, dtype=float)
    for tone in tones:
        template[NOTE_NAMES.index(tone)] = 1.0
    return template


def normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        return vector
    return vector / norm


def normalize_chord_name(chord: str) -> str:
    """Map a chord label like 'Bb', 'C#m', 'Am' to the internal sharp form."""
    if not chord:
        return ""
    chord = chord.strip()
    is_minor = chord.endswith("m") and not chord.endswith("dim")
    root = chord[:-1] if is_minor else chord
    root = FLAT_TO_SHARP.get(root, root)
    if root not in NOTE_NAMES:
        return chord
    return f"{root}m" if is_minor else root


TIMING_CREDIT = {"perfect": 1.0, "good": 0.75, "ok": 0.4, "miss": 0.0}


def match_onsets_to_slots(
    onset_times: np.ndarray, slot_times: list[float], max_offset: float
) -> dict[int, int]:
    """One-to-one greedy matching of detected onsets to expected strum times.

    Pairs are considered in order of smallest |onset - slot| so each onset can
    credit at most one slot and vice versa. Without this, a single strum can
    satisfy two adjacent slots, or a flurry of extra strums can mask a miss.
    Returns {slot_index: onset_index}.
    """
    pairs = []
    for slot_idx, slot_time in enumerate(slot_times):
        for onset_idx, onset_time in enumerate(onset_times):
            delta = abs(float(onset_time) - slot_time)
            if delta <= max_offset:
                pairs.append((delta, slot_idx, onset_idx))
    pairs.sort()

    matches: dict[int, int] = {}
    used_onsets: set[int] = set()
    for _, slot_idx, onset_idx in pairs:
        if slot_idx in matches or onset_idx in used_onsets:
            continue
        matches[slot_idx] = onset_idx
        used_onsets.add(onset_idx)
    return matches


def grade_timing(offset_seconds: float, beat_seconds: float) -> str:
    """Discrete rhythm-game timing grade, with windows scaled to the tempo."""
    error = abs(offset_seconds)
    if error <= max(0.05, beat_seconds * 0.125):
        return "perfect"
    if error <= beat_seconds * 0.25:
        return "good"
    if error <= beat_seconds * 0.5:
        return "ok"
    return "miss"


def score_performance(
    path: str,
    expected_chords: list[str],
    bpm: float,
    beats_per_chord: int,
) -> dict[str, Any]:
    """Compare a recording to an expected chord progression and produce a 0-100 score.

    Match, grade, aggregate: detected onsets are matched one-to-one to expected
    strum times, each slot gets a discrete timing grade and a chord identity, and
    the overall score blends chord accuracy, timing, and cleanliness.

    The proposal's onset-only baseline is this same pipeline with chord identity
    ignored (every matched slot counted correct) — chord accuracy is what our
    chroma matching adds over it.

    Returns the shape consumed by the React game in `game/src/App.jsx`.
    """
    if not expected_chords:
        raise AudioAnalysisError("Expected chord progression is empty.")
    if bpm <= 0 or beats_per_chord <= 0:
        raise AudioAnalysisError("Invalid bpm or beats_per_chord.")

    y, sr = load_audio(path)
    duration = float(librosa.get_duration(y=y, sr=sr))
    beat_seconds = 60.0 / float(bpm)
    seconds_per_chord = beat_seconds * float(beats_per_chord)

    onset_times = np.asarray(detect_onsets(y, sr), dtype=float)
    chroma = extract_chroma(y, sr)
    chroma_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr)

    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    rms_times = librosa.frames_to_time(np.arange(rms.size), sr=sr, hop_length=hop)
    global_rms = float(np.mean(rms)) if rms.size else 0.0
    silence_threshold = max(1e-4, global_rms * 0.35)

    slot_times = [i * seconds_per_chord for i in range(len(expected_chords))]
    matches = match_onsets_to_slots(onset_times, slot_times, max_offset=seconds_per_chord / 2)

    chord_results: list[dict[str, Any]] = []
    margins: list[float] = []
    timing_credits: list[float] = []
    correct_count = 0
    played_count = 0

    for i, expected_raw in enumerate(expected_chords):
        expected = normalize_chord_name(expected_raw)
        start = slot_times[i]
        end = min(start + seconds_per_chord, duration)
        onset_idx = matches.get(i)

        if onset_idx is None and start >= duration - 0.05:
            timing_credits.append(0.0)
            chord_results.append({"status": "missed", "expected": expected_raw,
                                  "detected": None, "confidence": 0.0,
                                  "timing_grade": "miss", "timing_offset_ms": None})
            continue

        if onset_idx is not None:
            onset_time = float(onset_times[onset_idx])
            offset = onset_time - start
            timing_grade = grade_timing(offset, beat_seconds)
            timing_offset_ms = int(round(offset * 1000.0))
            # Identify the chord from what rings right after the matched strum,
            # not the rigid slot grid — an early/late strum still gets judged on
            # the chord it actually played.
            window = TimeWindow(start=max(0.0, onset_time),
                                end=min(onset_time + min(1.0, seconds_per_chord), duration))
        else:
            slot_rms_mask = (rms_times >= start) & (rms_times < end)
            slot_rms = float(np.mean(rms[slot_rms_mask])) if np.any(slot_rms_mask) else 0.0
            if slot_rms < silence_threshold:
                timing_credits.append(0.0)
                chord_results.append({"status": "missed", "expected": expected_raw,
                                      "detected": None, "confidence": 0.0,
                                      "timing_grade": "miss", "timing_offset_ms": None})
                continue
            # Sound in the slot but no clear strum onset — judge the chord from
            # the slot window and count the timing as a miss.
            timing_grade = "miss"
            timing_offset_ms = None
            window = TimeWindow(start=start, end=end)

        timing_credits.append(TIMING_CREDIT[timing_grade])

        window_chroma = average_chroma_for_window(chroma, chroma_times, window)
        detected, confidence, margin = estimate_chord_with_margin(window_chroma)
        margins.append(float(margin))
        played_count += 1

        status = "correct" if normalize_chord_name(detected) == expected else "wrong"
        if status == "correct":
            correct_count += 1

        chord_results.append({
            "status": status,
            "expected": expected_raw,
            "detected": detected,
            "confidence": round(float(confidence), 3),
            "timing_grade": timing_grade,
            "timing_offset_ms": timing_offset_ms,
        })

    total = len(expected_chords)
    chord_accuracy = (correct_count / total) * 100.0 if total else 0.0
    timing_accuracy = float(np.mean(timing_credits) * 100.0) if timing_credits else 0.0

    extra_onset_count = int(onset_times.size) - len(matches)

    if margins:
        # A margin of ~0.15+ between the best and runner-up chord template means
        # a clean, unambiguous chord; near 0 means muted/buzzing/ambiguous.
        base_cleanliness = float(np.clip(np.mean(margins) / 0.15, 0.0, 1.0) * 100.0)
        extra_penalty = min(30.0, 30.0 * extra_onset_count / total)
        cleanliness = float(np.clip(base_cleanliness - extra_penalty, 0.0, 100.0))
    else:
        cleanliness = 0.0

    overall = 0.50 * chord_accuracy + 0.35 * timing_accuracy + 0.15 * cleanliness

    return {
        "overall_score": int(round(overall)),
        "chord_accuracy_pct": int(round(chord_accuracy)),
        "timing_accuracy_pct": int(round(timing_accuracy)),
        "cleanliness_pct": int(round(cleanliness)),
        "chord_results": chord_results,
        "expected_tempo_bpm": float(bpm),
        "beats_per_chord": int(beats_per_chord),
        "seconds_per_chord": round(seconds_per_chord, 3),
        "recording_duration_seconds": round(duration, 3),
        "onset_count": int(onset_times.size),
        "extra_onset_count": extra_onset_count,
        "played_count": played_count,
        "summary": _build_score_summary(overall, correct_count, total),
    }


def _build_score_summary(overall: float, correct: int, total: int) -> str:
    if total == 0:
        return "No chords to score."
    return (
        f"Played {correct} of {total} target chords correctly "
        f"({int(round(overall))}/100 overall)."
    )


def build_summary(
    tempo: float, onset_times: list[float], chord_estimates: list[dict[str, Any]]
) -> str:
    chord_counts = Counter(
        estimate["chord"] for estimate in chord_estimates if estimate["chord"] != "Unknown"
    )
    common_chords = [chord for chord, _ in chord_counts.most_common(4)]

    if common_chords:
        chord_text = ", ".join(common_chords)
        return (
            f"Detected an estimated tempo of {tempo:.1f} BPM and "
            f"{len(onset_times)} likely strum events. The most common estimated chords were "
            f"{chord_text}."
        )

    return (
        f"Detected an estimated tempo of {tempo:.1f} BPM and "
        f"{len(onset_times)} likely strum events. No supported beginner chords were clearly detected."
    )
