// electron/TranscriptionHelper.ts

import Groq from "groq-sdk"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import os from "os"

dotenv.config()

export class TranscriptionHelper {
  private groq: Groq | null = null

  constructor() {
    const apiKey = process.env.GROQ_API_KEY
    if (apiKey) {
      this.groq = new Groq({ apiKey })
      console.log("[TranscriptionHelper] Initialized with Groq API key")
    } else {
      console.warn("[TranscriptionHelper] No GROQ_API_KEY — transcription disabled")
    }
  }

  public isConfigured(): boolean {
    return this.groq !== null
  }

  /**
   * Transcribe a raw audio buffer (webm/opus from MediaRecorder).
   * Writes to a temp file, sends to Groq, cleans up.
   */
  public async transcribe(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<string> {
    if (!this.groq) {
      return ""
    }

    const ext = mimeType.includes("webm") ? ".webm" : mimeType.includes("mp4") ? ".mp4" : ".webm"
    const tmpPath = path.join(os.tmpdir(), `manusman-mic-${Date.now()}${ext}`)

    try {
      await fs.promises.writeFile(tmpPath, audioBuffer)

      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: "whisper-large-v3",
        response_format: "text",
        language: "en",
      })

      const text = typeof transcription === "string" ? transcription : (transcription as any).text || ""
      console.log(`[TranscriptionHelper] Transcribed ${audioBuffer.length} bytes → ${text.length} chars`)
      return text.trim()
    } catch (error: any) {
      console.error("[TranscriptionHelper] Transcription failed:", error.message)
      return ""
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {})
    }
  }
}
