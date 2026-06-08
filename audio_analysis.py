from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

import librosa
import numpy as np


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

CHORD_TONES = {
    "C": ["C", "E", "G"],
    "G": ["G", "B", "D"],
    "Am": ["A", "C", "E"],
    "F": ["F", "A", "C"],
    "Dm": ["D", "F", "A"],
    "Em": ["E", "G", "B"],
}


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
        y, sr = librosa.load(path, sr=None, mono=True)
    except Exception as exc:
        raise AudioAnalysisError(
            "Could not read the uploaded audio file. Try a valid WAV, MP3, or M4A file."
        ) from exc

    if y.size == 0:
        raise AudioAnalysisError("The uploaded audio file is empty.")

    if not np.isfinite(y).all():
        raise AudioAnalysisError("The uploaded audio file contains invalid sample data.")

    if float(np.max(np.abs(y))) < 1e-6:
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
    normalized_chroma = normalize(chroma_vector)
    if float(np.linalg.norm(normalized_chroma)) == 0.0:
        return "Unknown", 0.0

    best_chord = "Unknown"
    best_score = 0.0

    for chord_name, tones in CHORD_TONES.items():
        template = chord_template(tones)
        score = float(np.dot(normalized_chroma, normalize(template)))
        if score > best_score:
            best_chord = chord_name
            best_score = score

    return best_chord, best_score


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
