Build an initial Python backend prototype for a ukulele rhythm-game practice tool.

Context:
We are making a retrospective audio-analysis system. The user plays ukulele along with a game interface, the browser records the full attempt, and then the backend analyzes the recording after the round is over. This first prototype does not need real-time feedback. It only needs to take in an uploaded audio recording and return basic music-perception information: detected strum/onset times, estimated tempo, and likely notes/chords played over time.

Use:

* Python
* FastAPI for the backend
* librosa for audio analysis
* NumPy for numerical processing
* Optional: matplotlib only if useful for saving debug plots

Core task:
Create a FastAPI app with an endpoint:

POST /analyze

The endpoint should accept an uploaded audio file, preferably wav/mp3/m4a if supported, save it temporarily, load it with librosa, analyze it, and return JSON.

The returned JSON should include:

1. estimated_tempo_bpm
2. onset_times_seconds: list of detected strum/onset times
3. note_activity_over_time: a list of time windows with the strongest detected pitch classes/notes
4. chord_estimates: a list of time windows with the best-matching chord name and confidence score
5. summary: a short human-readable summary

For this prototype, support these ukulele beginner chords:

* C major: C E G
* G major: G B D
* A minor: A C E
* F major: F A C
* D minor: D F A
* E minor: E G B

Implementation details:

* Use librosa.load to load the audio.
* Use librosa.onset.onset_detect to detect strum/onset times.
* Use librosa.beat.beat_track to estimate tempo.
* Use a chroma feature such as librosa.feature.chroma_cqt or librosa.feature.chroma_stft to represent pitch-class energy.
* Convert chroma frame indexes into timestamps.
* For each time window, average the chroma vector.
* Implement simple chord-template matching:

  * Each chord template should be a 12-dimensional vector representing its chord tones.
  * Normalize the chroma vector and chord template.
  * Compare them using cosine similarity.
  * Return the chord with the highest similarity as the chord estimate.
* Also return the top 3 strongest pitch classes in each window as note estimates.
* Use note names: C, C#, D, D#, E, F, F#, G, G#, A, A#, B.

Windowing:
For the initial version, segment the audio using onset times if possible. Each chord event can be a window from one onset to the next onset. If there are too few onsets, fall back to fixed-length windows of around 1 second.

Expected output example:
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

Project structure:

* main.py: FastAPI app and /analyze endpoint
* audio_analysis.py: reusable functions for loading audio, onset detection, tempo estimation, chroma extraction, note estimation, and chord matching
* requirements.txt
* README.md with setup and run instructions

Important:

* Make the code simple, readable, and commented.
* Include error handling for unsupported or empty audio files.
* Clean up temporary files after analysis.
* Do not build the frontend yet.
* Do not train a machine learning model.
* This is a signal-processing prototype using librosa features and chord-template matching.
* Include instructions for testing with curl or a simple Python requests script.

After writing the code, explain how to run it locally and how to test it with an example audio file.
