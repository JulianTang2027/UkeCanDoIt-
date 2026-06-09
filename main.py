from __future__ import annotations

import json
import logging
import os
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from audio_analysis import AudioAnalysisError, analyze_audio_file, score_performance

logger = logging.getLogger("ukecandoit")
logging.basicConfig(level=logging.INFO)


app = FastAPI(
    title="UkeCanDoIt Audio Analysis API",
    description="Prototype retrospective audio analysis for ukulele rhythm-game practice.",
    version="0.1.0",
)

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".webm"}
FRONTEND_DIR = Path(__file__).parent / "docs"

# The React game runs from a separate Vite dev server during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.get("/")
def read_root():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return RedirectResponse(url="/frontend/")
    return {"status": "ok", "message": "POST an audio file to /analyze."}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix and suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{suffix}'. Try WAV, MP3, M4A, AAC, OGG, or FLAC.",
        )

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".audio") as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(1024 * 1024):
                temp_file.write(chunk)

        if os.path.getsize(temp_path) == 0:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

        return analyze_audio_file(temp_path)
    except AudioAnalysisError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await file.close()
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/score")
async def score(
    file: UploadFile = File(...),
    chords: str = Form(...),
    bpm: float = Form(...),
    beats_per_chord: int = Form(...),
) -> dict:
    """Score a performance against an expected chord progression."""
    try:
        expected_chords = json.loads(chords)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="`chords` must be a JSON array of chord names.") from exc

    if not isinstance(expected_chords, list) or not all(isinstance(c, str) for c in expected_chords):
        raise HTTPException(status_code=400, detail="`chords` must be a JSON array of chord names.")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix and suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{suffix}'. Try WAV, MP3, M4A, WEBM, OGG, or FLAC.",
        )

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".audio") as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(1024 * 1024):
                temp_file.write(chunk)

        if os.path.getsize(temp_path) == 0:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

        return score_performance(
            temp_path,
            expected_chords=expected_chords,
            bpm=bpm,
            beats_per_chord=beats_per_chord,
        )
    except AudioAnalysisError as exc:
        logger.warning("/score rejected upload: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        logger.error("/score crashed:\n%s", traceback.format_exc())
        raise
    finally:
        await file.close()
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
