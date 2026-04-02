import dotenv from "dotenv"

dotenv.config()

interface ManusTaskResponse {
  taskId: string
  taskUrl: string
}

interface ManusTaskStatus {
  id: string
  object: string
  created_at: number
  updated_at: number
  status: "pending" | "running" | "completed" | "failed" | "error"
  error: string | null
  model: string
  metadata: Record<string, any>
  output: ManusMessage[]
  credit_usage: number | null
}

interface ManusMessage {
  id: string
  status?: string
  role: "user" | "assistant"
  type?: string
  content: ManusContentBlock[]
}

interface ManusContentBlock {
  type: "output_text" | "text" | "output_file" | "input_text"
  text?: string
  fileUrl?: string | null
  fileName?: string | null
  mimeType?: string | null
}

export interface ManusResult {
  taskId: string
  taskUrl: string
  status: "pending" | "running" | "completed" | "failed" | "error"
  text: string
  files: Array<{ url: string; name: string; mimeType: string }>
  raw: ManusTaskStatus | null
}

export class ManusHelper {
  private apiKey: string
  private baseUrl: string = "https://api.manus.ai"
  private pollIntervalMs: number = 3000
  private maxPollAttempts: number = 120 // 6 minutes max

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.MANUS_API_KEY || ""
    if (!this.apiKey) {
      console.warn("[ManusHelper] No MANUS_API_KEY found — Manus tools will not work")
    }
  }

  public isConfigured(): boolean {
    return this.apiKey.length > 0
  }

  public async createTask(
    prompt: string,
    attachments?: Array<{ filename: string; fileData?: string; url?: string; mimeType?: string }>,
    options?: { taskMode?: string; connectors?: string[]; agentProfile?: string }
  ): Promise<ManusTaskResponse> {
    const body: Record<string, any> = {
      prompt,
      mode: options?.agentProfile || "speed",
    }

    if (attachments && attachments.length > 0) {
      body.attachments = attachments
    }

    if (options?.connectors) {
      body.connectors = options.connectors
    }

    if (options?.taskMode) {
      body.taskMode = options.taskMode
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/tasks`, {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "API_KEY": this.apiKey,
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Manus API error: ${response.status} - ${errorBody}`)
      }

      const data = await response.json()
      console.log(`[ManusHelper] Raw create response:`, JSON.stringify(data))
      // Handle different possible field names from Manus API
      const taskId = data.taskId || data.task_id || data.id
      const taskUrl = data.taskUrl || data.task_url || data.metadata?.task_url || ""
      console.log(`[ManusHelper] Task created: ${taskId} (url: ${taskUrl})`)
      if (!taskId) {
        throw new Error(`Manus create response missing taskId. Got: ${JSON.stringify(data)}`)
      }
      return { taskId, taskUrl }
    } catch (error) {
      console.error("[ManusHelper] Error creating task:", error)
      throw error
    }
  }

  public async getTaskStatus(taskId: string): Promise<ManusTaskStatus> {
    const url = `${this.baseUrl}/v1/tasks/${taskId}`
    console.log(`[ManusHelper] Polling: ${url}`)
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "API_KEY": this.apiKey,
        "Authorization": `Bearer ${this.apiKey}`,
      },
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Manus status error: ${response.status} - ${errorBody}`)
    }

    const data = await response.json()

    // Manus sometimes returns error objects with 200 status
    if (data.code && data.message) {
      throw new Error(`Manus API error: ${data.message} (code ${data.code})`)
    }

    return data
  }

  public async pollUntilComplete(
    taskId: string,
    onStatusUpdate?: (status: string) => void,
    onPartialResult?: (partial: ManusResult) => void
  ): Promise<ManusResult> {
    let attempts = 0
    let lastSeenMessageCount = 0

    while (attempts < this.maxPollAttempts) {
      attempts++

      try {
        const status = await this.getTaskStatus(taskId)

        if (onStatusUpdate) {
          onStatusUpdate(status.status)
        }

        // Emit partial results as new assistant messages appear
        if (onPartialResult && status.output) {
          const assistantMessages = status.output.filter(m => m.role === "assistant")
          if (assistantMessages.length > lastSeenMessageCount) {
            lastSeenMessageCount = assistantMessages.length
            const partial = this.parseTaskResult(taskId, status)
            partial.status = status.status // keep actual status, not "completed"
            onPartialResult(partial)
          }
        }

        if (status.status === "completed") {
          return this.parseTaskResult(taskId, status)
        }

        if (status.status === "failed" || status.status === "error") {
          return {
            taskId,
            taskUrl: status.metadata?.task_url || "",
            status: status.status,
            text: status.error || "Task failed",
            files: [],
            raw: status,
          }
        }

        // If pending (waiting for user input), auto-continue
        if (status.status === "pending") {
          console.log(`[ManusHelper] Task ${taskId} is pending — sending auto-continue`)
          try {
            await this.continueTask(taskId, "Continue. Do not wait for my input. Complete the task with what you have.")
          } catch (err) {
            console.error("[ManusHelper] Auto-continue failed:", err)
          }
        }

        // Still running/pending — wait and poll again
        await this.sleep(this.pollIntervalMs)
      } catch (error) {
        console.error(`[ManusHelper] Poll attempt ${attempts} failed:`, error)
        if (attempts >= this.maxPollAttempts) throw error
        await this.sleep(this.pollIntervalMs)
      }
    }

    throw new Error(`Manus task ${taskId} timed out after ${this.maxPollAttempts} attempts`)
  }

  /**
   * Run a tool: create task + poll until done. Returns parsed result.
   * Multiple calls to this can run in parallel via Promise.all.
   */
  public async runTool(
    toolName: string,
    prompt: string,
    attachments?: Array<{ filename: string; fileData?: string; url?: string; mimeType?: string }>,
    onStatusUpdate?: (status: string) => void,
    onPartialResult?: (partial: ManusResult) => void
  ): Promise<ManusResult & { toolName: string }> {
    console.log(`[ManusHelper] Running tool: ${toolName}`)

    const { taskId, taskUrl } = await this.createTask(prompt, attachments, {
      taskMode: "agent",
      agentProfile: "agent",
    })

    // Small delay before first poll — Manus returns 404 if polled immediately
    await this.sleep(2000)

    const result = await this.pollUntilComplete(taskId, onStatusUpdate, onPartialResult)
    return { ...result, taskUrl, toolName }
  }

  public async continueTask(taskId: string, message: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/tasks`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "API_KEY": this.apiKey,
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        taskId,
        prompt: message,
        mode: "speed",
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Manus continue error: ${response.status} - ${errorBody}`)
    }
  }

  private parseTaskResult(taskId: string, status: ManusTaskStatus): ManusResult {
    const files: Array<{ url: string; name: string; mimeType: string }> = []
    let finalText = ""

    if (status.output) {
      const assistantMessages = status.output.filter(
        m => m.role === "assistant" && m.content && m.content.length > 0
      )

      // Strategy: scan ALL assistant messages for JSON with a "display" field.
      // Manus sometimes sends the JSON first, then a follow-up prose message.
      // We want the JSON, not the prose.
      let jsonText = ""
      let lastPlainText = ""

      for (const msg of assistantMessages) {
        for (const block of msg.content) {
          if ((block.type === "output_text" || block.type === "text") && block.text) {
            const cleaned = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
            try {
              const parsed = JSON.parse(cleaned)
              if (parsed.display) {
                jsonText = block.text // found structured JSON with display field
              }
            } catch {
              // not JSON — track as plain text fallback
            }
            lastPlainText = block.text
          }
          if (block.type === "output_file" && block.fileUrl) {
            files.push({
              url: block.fileUrl,
              name: block.fileName || "file",
              mimeType: block.mimeType || "application/octet-stream",
            })
          }
        }
      }

      // Prefer JSON with display field, fall back to last plain text
      finalText = jsonText || lastPlainText
    }

    return {
      taskId,
      taskUrl: status.metadata?.task_url || "",
      status: "completed",
      text: finalText,
      files,
      raw: status,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
