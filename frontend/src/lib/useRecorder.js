import { useCallback, useEffect, useRef, useState } from 'react'

// Microphone capture via getUserMedia + MediaRecorder.
// `stop()` resolves with the recorded Blob (webm/ogg, depending on the browser).
export function useRecorder() {
  const [status, setStatus] = useState('idle') // 'idle' | 'recording'
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const resolveRef = useRef(null)

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Stop tracks/timer if the component unmounts mid-recording.
  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const type = chunksRef.current[0]?.type || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        cleanup()
        setStatus('idle')
        if (resolveRef.current) {
          resolveRef.current(blob)
          resolveRef.current = null
        }
      }

      recorderRef.current = recorder
      recorder.start()
      setStatus('recording')
      setElapsed(0)
      const startedAt = Date.now()
      timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 200)
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : 'Could not access the microphone.',
      )
      setStatus('idle')
    }
  }, [cleanup])

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(null)
        return
      }
      resolveRef.current = resolve
      recorder.stop()
    })
  }, [])

  return { status, elapsed, error, start, stop }
}
