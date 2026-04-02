import React from "react"

const TOOL_LABELS: Record<string, string> = {
  who_is_this: "Looking up person",
  meeting_brief: "Preparing brief",
  live_fact_check: "Fact-checking",
  company_snapshot: "Researching company",
  deal_status: "Checking deal status",
  competitive_intel: "Gathering intel",
  number_lookup: "Finding that number",
}

interface ToolSpinnerProps {
  toolName: string
  status: string
}

const ToolSpinner: React.FC<ToolSpinnerProps> = ({ toolName, status }) => {
  const label = TOOL_LABELS[toolName] || toolName

  return (
    <div className="p-3 bg-black/60 backdrop-blur-md rounded-lg border border-white/10">
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
        </div>
        <span className="text-sm text-white/80">{label}...</span>
        <span className="text-xs text-white/40">{status}</span>
      </div>
    </div>
  )
}

export default ToolSpinner
