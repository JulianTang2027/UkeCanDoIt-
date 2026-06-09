# UkeCanDoIt Audio Analysis Prototype

Initial Python backend prototype for retrospective ukulele practice analysis. The API accepts an uploaded audio recording, analyzes it after the round is over, and returns detected onsets, estimated tempo, likely note activity, and simple chord-template matches.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run

```powershell
uvicorn main:app --reload
```

The API will run at `http://127.0.0.1:8000`.

## Analyze An Audio File

```powershell
curl.exe -X POST "http://127.0.0.1:8000/analyze" -F "file=@C:\path\to\ukulele.wav"
```

Or with Python:

```python
import requests

with open(r"C:\path\to\ukulele.wav", "rb") as audio_file:
    response = requests.post(
        "http://127.0.0.1:8000/analyze",
        files={"file": audio_file},
        timeout=60,
    )

print(response.status_code)
print(response.json())
```

## Response Shape

```json
{
  "estimated_tempo_bpm": 92.3,
  "onset_times_seconds": [0.42, 1.08, 1.75, 2.41],
  "note_activity_over_time": [
    {
      "start": 0.42,
      "end": 1.08,
      "top_notes": ["C", "E", "G"]
    }
  ],
  "chord_estimates": [
    {
      "start": 0.42,
      "end": 1.08,
      "chord": "C",
      "confidence": 0.86
    }
  ],
  "summary": "Detected an estimated tempo of 92.3 BPM and 4 likely strum events. The most common estimated chords were C, G, Am, and F."
}
```

## Score A Performance

`POST /score` is what the React game in `game/` calls. It compares a recording
to an expected chord progression and returns a 0-100 score with sub-scores per
category. The request is `multipart/form-data` with:

- `file`: the audio recording (WAV/MP3/M4A/WEBM/OGG/FLAC)
- `chords`: JSON array of chord names, e.g. `["Am","G","C","F"]`
- `bpm`: number, target tempo
- `beats_per_chord`: integer

Response shape:

```json
{
  "overall_score": 87,
  "chord_accuracy_pct": 81,
  "timing_accuracy_pct": 94,
  "cleanliness_pct": 78,
  "chord_results": [
    {"status": "correct", "expected": "Am", "detected": "Am", "confidence": 0.74},
    {"status": "wrong",   "expected": "G",  "detected": "Em", "confidence": 0.61},
    {"status": "missed",  "expected": "C",  "detected": null, "confidence": 0.0}
  ],
  "summary": "Played 12 of 16 target chords correctly (87/100 overall)."
}
```

Scoring is a weighted blend: `0.55 * chord + 0.30 * timing + 0.15 * cleanliness`.
A slot is `missed` when both its RMS energy and onset count fall below threshold,
`wrong` when a chord is heard but doesn't match the expected one, otherwise `correct`.

## Notes

This is a signal-processing prototype, not a trained model. Chord estimates are
based on chroma features and cosine similarity against major and minor triad
templates for all 12 roots (so `C`, `Am`, `C#m`, `Bb` etc. are all valid inputs).

Supported uploads depend on the local audio backend available to `librosa`.
WAV and FLAC work reliably through `soundfile`. MP3/M4A/WEBM/OGG go through
`audioread`, which needs `ffmpeg` on PATH — install ffmpeg if browser-recorded
`.webm` files come back with an "audio file could not be read" error.
