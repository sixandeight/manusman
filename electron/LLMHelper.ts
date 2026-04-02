import fs from "fs"

interface KimiResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

interface OllamaResponse {
  response: string
  done: boolean
}

export class LLMHelper {
  private apiKey: string = ""
  private baseUrl: string = "https://api.moonshot.ai/v1"
  private kimiModel: string = "kimi-k2.5"
  private kimiVisionModel: string = "kimi-k2.5"

  private readonly systemPrompt = `You are Manusman, a business and consulting assistant. You analyze screenshots of conversations, emails, documents, and other business content.

Rules:
- Be concise. No filler, no fluff.
- Be direct and casual in tone.
- Be logical and precise — say exactly what you mean.
- Lead with the answer, then context only if needed.
- When suggesting actions, give max 3 concrete next steps.
- Never repeat back what the user already knows.
- Never explain your reasoning unless asked.`

  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama

    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest"
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      this.initializeOllamaModel()
    } else if (apiKey) {
      this.apiKey = apiKey
      console.log("[LLMHelper] Using Kimi/Moonshot AI")
    } else {
      throw new Error("Either provide Kimi API key or enable Ollama mode")
    }
  }

  private cleanJsonResponse(text: string): string {
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '')
    text = text.trim()
    return text
  }

  // ── Kimi/Moonshot API ──────────────────────────────────────────

  private async callKimi(messages: any[], useVision: boolean = false): Promise<string> {
    try {
      const model = useVision ? this.kimiVisionModel : this.kimiModel
      const isK25 = model.startsWith("kimi-k2")

      // kimi-k2.5 has fixed params — temperature/top_p/n/penalties CANNOT be set
      const body: Record<string, any> = { model, messages }
      if (isK25) {
        body.thinking = { type: "disabled" } // faster, no internal reasoning overhead
      } else {
        body.temperature = 0.7
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Kimi API error: ${response.status} ${response.statusText} - ${errorBody}`)
      }

      const data: KimiResponse = await response.json()
      return data.choices[0].message.content
    } catch (error) {
      console.error("[LLMHelper] Error calling Kimi:", error)
      throw error
    }
  }

  private imageToKimiPart(base64Data: string, mimeType: string = "image/png") {
    return {
      type: "image_url" as const,
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`
      }
    }
  }

  // ── Ollama API (unchanged) ────────────────────────────────────

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: { temperature: 0.7, top_p: 0.9 }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  // ── Public methods ────────────────────────────────────────────

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const imagePartsPromises = imagePaths.map(async (path) => {
        const imageData = await fs.promises.readFile(path)
        return this.imageToKimiPart(imageData.toString("base64"))
      })
      const imageParts = await Promise.all(imagePartsPromises)

      const userPrompt = `Analyze these images and extract the following as JSON:\n{\n  "problem_statement": "What is the core situation or question here.",\n  "context": "Key people, companies, dates, or details visible.",\n  "suggested_responses": ["Action 1", "Action 2", "Action 3"],\n  "reasoning": "Why these actions make sense — one sentence."\n}\nReturn ONLY the JSON object. No markdown, no code blocks.`

      const messages = [
        { role: "system", content: this.systemPrompt },
        {
          role: "user",
          content: [
            ...imageParts,
            { type: "text", text: userPrompt }
          ]
        }
      ]

      const text = await this.callKimi(messages, true)
      return JSON.parse(this.cleanJsonResponse(text))
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const userPrompt = `Given this situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nRespond as JSON:\n{\n  "solution": {\n    "code": "Your direct answer or recommended response.",\n    "problem_statement": "The core issue in one sentence.",\n    "context": "Key details — people, companies, deadlines.",\n    "suggested_responses": ["Action 1", "Action 2", "Action 3"],\n    "reasoning": "Why — one sentence."\n  }\n}\nReturn ONLY the JSON object. No markdown, no code blocks.`

    console.log("[LLMHelper] Calling Kimi LLM for solution...")
    try {
      const messages = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userPrompt }
      ]

      const text = await this.callKimi(messages)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error)
      throw error
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const imagePartsPromises = debugImagePaths.map(async (path) => {
        const imageData = await fs.promises.readFile(path)
        return this.imageToKimiPart(imageData.toString("base64"))
      })
      const imageParts = await Promise.all(imagePartsPromises)

      const userPrompt = `Given:\n1. Original situation: ${JSON.stringify(problemInfo, null, 2)}\n2. Current approach: ${currentCode}\n3. New context in the attached images\n\nRevise your answer based on the new information. Respond as JSON:\n{\n  "solution": {\n    "code": "Your revised answer or recommendation.",\n    "problem_statement": "Updated core issue — one sentence.",\n    "context": "What changed or what's new.",\n    "suggested_responses": ["Action 1", "Action 2", "Action 3"],\n    "reasoning": "Why the revision — one sentence."\n  }\n}\nReturn ONLY the JSON object. No markdown, no code blocks.`

      const messages = [
        { role: "system", content: this.systemPrompt },
        {
          role: "user",
          content: [
            ...imageParts,
            { type: "text", text: userPrompt }
          ]
        }
      ]

      const text = await this.callKimi(messages, true)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      // Kimi doesn't support audio natively — read and describe via text prompt
      const prompt = `${this.systemPrompt}\n\nThe user has provided an audio file at: ${audioPath}. Audio analysis is not directly supported. Please let the user know they can describe what they heard, or use the chat to ask questions instead.`

      const messages = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: "I have an audio file I'd like analyzed. Please suggest how I can get help with it." }
      ]

      const text = await this.callKimi(messages)
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing audio file:", error)
      throw error
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const messages = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: "I have an audio recording I'd like analyzed. Audio input isn't directly supported by this model. Please suggest how I can get help with it." }
      ]

      const text = await this.callKimi(messages)
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing audio from base64:", error)
      throw error
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath)
      const imagePart = this.imageToKimiPart(imageData.toString("base64"))

      const messages = [
        { role: "system", content: this.systemPrompt },
        {
          role: "user",
          content: [
            imagePart,
            { type: "text", text: "Analyze this image. Identify what it shows — conversation, email, document, data, or other content. Give a brief summary and up to 3 actionable next steps. No filler." }
          ]
        }
      ]

      const text = await this.callKimi(messages, true)
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing image file:", error)
      throw error
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOllama) {
        return this.callOllama(message)
      } else {
        const messages = [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: message }
        ]
        return this.callKimi(messages)
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chat:", error)
      throw error
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message)
  }

  public isUsingOllama(): boolean {
    return this.useOllama
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return []

    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      if (!response.ok) throw new Error('Failed to fetch models')

      const data = await response.json()
      return data.models?.map((model: any) => model.name) || []
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error)
      return []
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini"
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : this.kimiModel
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true
    if (url) this.ollamaUrl = url

    if (model) {
      this.ollamaModel = model
    } else {
      await this.initializeOllamaModel()
    }

    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`)
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      this.apiKey = apiKey
    }

    if (!this.apiKey) {
      throw new Error("No Kimi API key provided")
    }

    this.useOllama = false
    console.log("[LLMHelper] Switched to Kimi")
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable()
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` }
        }
        await this.callOllama("Hello")
        return { success: true }
      } else {
        const messages = [
          { role: "user", content: "Hello" }
        ]
        const text = await this.callKimi(messages)
        if (text) {
          return { success: true }
        } else {
          return { success: false, error: "Empty response from Kimi" }
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}
