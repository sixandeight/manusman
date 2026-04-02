import React, { useState, useRef, useEffect } from "react"

const TOOL_LABELS: Record<string, { label: string; placeholder: string }> = {
  meeting_brief: { label: "Meeting Brief", placeholder: "Person or company name..." },
  company_snapshot: { label: "Company Snapshot", placeholder: "Company name..." },
  deal_status: { label: "Deal Status", placeholder: "Client name..." },
  number_lookup: { label: "Number Lookup", placeholder: "What stat to find..." },
  who_is_this: { label: "Who Is This?", placeholder: "Any extra context (optional)..." },
  live_fact_check: { label: "Fact Check", placeholder: "What claim to verify..." },
  competitive_intel: { label: "Competitive Intel", placeholder: "Competitor name..." },
}

interface ToolPromptProps {
  toolName: string
  needsScreenshot: boolean
  onSubmit: (toolName: string, args: Record<string, string>, screenshotPath?: string) => void
  onCancel: () => void
}

const ToolPrompt: React.FC<ToolPromptProps> = ({ toolName, needsScreenshot, onSubmit, onCancel }) => {
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const config = TOOL_LABELS[toolName] || { label: toolName, placeholder: "Enter query..." }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Build args based on tool type
    const args: Record<string, string> = {}
    switch (toolName) {
      case "meeting_brief":
        args.person_or_company = input
        break
      case "company_snapshot":
        args.company_name = input
        break
      case "deal_status":
        args.client_name = input
        break
      case "number_lookup":
        args.query = input
        break
      case "who_is_this":
        args.context = input || "See attached screenshot"
        break
      case "live_fact_check":
        args.claim = input
        break
      case "competitive_intel":
        args.competitor_name = input
        break
    }

    let screenshotPath: string | undefined
    if (needsScreenshot) {
      screenshotPath = await window.electronAPI.getLastScreenshotPath() || undefined
    }

    onSubmit(toolName, args, screenshotPath)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel()
  }

  return (
    <div className="p-3 bg-black/70 backdrop-blur-md rounded-lg border border-white/20 shadow-xl">
      <div className="text-sm font-medium text-white/90 mb-2">{config.label}</div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={config.placeholder}
          className="flex-1 px-3 py-2 bg-white/15 text-white placeholder-white/40 text-sm rounded-md border border-white/20 focus:outline-none focus:border-white/40"
        />
        <button
          type="submit"
          className="px-3 py-2 bg-blue-500/80 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
        >
          Go
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white/70 text-sm rounded-md transition-colors"
        >
          Esc
        </button>
      </form>
    </div>
  )
}

export default ToolPrompt
