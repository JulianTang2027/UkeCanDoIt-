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

## Notes

This is a signal-processing prototype, not a trained model. Chord estimates are based on chroma features and cosine similarity against these beginner chord templates:

- C: C E G
- G: G B D
- Am: A C E
- F: F A C
- Dm: D F A
- Em: E G B

Supported uploads depend on the local audio backend available to `librosa`. WAV and FLAC should work reliably through `soundfile`; MP3 and M4A support may depend on installed codec support.
