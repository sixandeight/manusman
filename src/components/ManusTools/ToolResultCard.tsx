import React from "react"

interface ManusToolResult {
  toolName: string
  taskId: string
  taskUrl: string
  status: string
  text: string
  files: Array<{ url: string; name: string; mimeType: string }>
}

const TOOL_ICONS: Record<string, string> = {
  who_is_this: "Person",
  meeting_brief: "Brief",
  live_fact_check: "Fact Check",
  company_snapshot: "Company",
  deal_status: "Deal",
  competitive_intel: "Intel",
  number_lookup: "Stat",
}

const TOOL_COLORS: Record<string, string> = {
  who_is_this: "border-purple-400/40",
  meeting_brief: "border-green-400/40",
  live_fact_check: "border-yellow-400/40",
  company_snapshot: "border-blue-400/40",
  deal_status: "border-orange-400/40",
  competitive_intel: "border-red-400/40",
  number_lookup: "border-cyan-400/40",
}

interface ToolResultCardProps {
  result: ManusToolResult
  onDismiss: () => void
}

const ToolResultCard: React.FC<ToolResultCardProps> = ({ result, onDismiss }) => {
  const label = TOOL_ICONS[result.toolName] || result.toolName
  const borderColor = TOOL_COLORS[result.toolName] || "border-white/20"

  // Split text into paragraphs for display
  const paragraphs = result.text.split("\n\n").filter(Boolean)

  return (
    <div className={`p-4 rounded-lg shadow-xl relative`} style={{ background: "rgba(0, 200, 100, 0.2)", border: `2px solid rgba(0, 200, 100, 0.5)` }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">{label}</span>
          {result.status === "completed" && (
            <span className="w-2 h-2 bg-green-400 rounded-full" />
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-white/30 hover:text-white/60 text-sm transition-colors"
        >
          x
        </button>
      </div>

      {/* Content */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-white/90 leading-relaxed">
            {p}
          </p>
        ))}
      </div>

      {/* Files */}
      {result.files.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="text-xs text-white/40 mb-1">Attachments</div>
          {result.files.map((file, i) => (
            <a
              key={i}
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 block"
            >
              {file.name}
            </a>
          ))}
        </div>
      )}

      {/* Footer */}
      {result.taskUrl && (
        <div className="mt-3 pt-2 border-t border-white/10">
          <a
            href={result.taskUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-white/30 hover:text-white/50"
          >
            View in Manus
          </a>
        </div>
      )}
    </div>
  )
}

export default ToolResultCard
