import React, { useMemo } from "react"
import StatCard from "./presets/StatCard"
import ComparisonCard from "./presets/ComparisonCard"
import ProfileCard from "./presets/ProfileCard"
import VerdictCard from "./presets/VerdictCard"
import ChecklistCard from "./presets/ChecklistCard"
import PipelineCard from "./presets/PipelineCard"
import ChartCard from "./presets/ChartCard"

interface ManusToolResult {
  toolName: string
  taskId: string
  taskUrl: string
  status: string
  text: string
  files: Array<{ url: string; name: string; mimeType: string }>
  _partial?: boolean
}

const TOOL_COLORS: Record<string, string> = {
  who_is_this: "#a78bfa",
  meeting_brief: "#4ade80",
  live_fact_check: "#facc15",
  company_snapshot: "#60a5fa",
  deal_status: "#fb923c",
  competitive_intel: "#f87171",
  number_lookup: "#22d3ee",
}

const TOOL_LABELS: Record<string, string> = {
  who_is_this: "PERSON",
  meeting_brief: "BRIEF",
  live_fact_check: "FACT CHECK",
  company_snapshot: "COMPANY",
  deal_status: "DEAL",
  competitive_intel: "INTEL",
  number_lookup: "STAT",
}

// Display type → label override
const DISPLAY_LABELS: Record<string, string> = {
  stat_card: "STAT",
  comparison: "COMPARISON",
  profile: "PERSON",
  verdict: "VERDICT",
  checklist: "BRIEF",
  pipeline: "PIPELINE",
  chart: "CHART",
}

interface ToolResultCardProps {
  result: ManusToolResult
  onDismiss: () => void
}

const ToolResultCard: React.FC<ToolResultCardProps> = ({ result, onDismiss }) => {
  const color = TOOL_COLORS[result.toolName] || "#888"
  const isPartial = result._partial

  // Try to parse structured JSON
  const parsed = useMemo(() => {
    if (!result.text) return null
    try {
      let text = result.text.trim()
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
      const obj = JSON.parse(text)
      if (obj.display) return obj
      return null
    } catch {
      return null
    }
  }, [result.text])

  const label = parsed?.display
    ? (DISPLAY_LABELS[parsed.display] || parsed.display.toUpperCase())
    : (TOOL_LABELS[result.toolName] || result.toolName)

  return (
    <div
      className="rounded-lg shadow-xl relative overflow-hidden"
      style={{
        background: "rgba(10, 15, 30, 0.88)",
        borderLeft: `3px solid ${color}`,
        boxShadow: `0 0 20px ${color}22`,
      }}
    >
      {/* Header — draggable zone */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 cursor-grab">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>
            {label}
          </span>
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: isPartial ? "#facc15" : "#4ade80",
              boxShadow: `0 0 6px ${isPartial ? "#facc15" : "#4ade80"}`,
            }}
          />
          {isPartial && <span className="text-xs text-white/30">streaming</span>}
        </div>
        <button onClick={onDismiss} className="text-white/20 hover:text-white/50 text-sm px-1">x</button>
      </div>

      <div className="h-px w-full" style={{ background: `${color}33` }} />

      {/* Content */}
      <div className="px-4 py-3 max-h-[400px] overflow-y-auto">
        {parsed ? (
          <PresetRouter data={parsed} />
        ) : (
          // Raw text fallback
          <div className="space-y-2">
            {result.text.split("\n\n").filter(Boolean).map((p, i) => (
              <p key={i} className="text-sm text-white/85 leading-relaxed">{p}</p>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {(result.files.length > 0 || result.taskUrl) && (
        <>
          <div className="h-px w-full" style={{ background: `${color}22` }} />
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex gap-3">
              {result.files.map((file, i) => (
                <a key={i} href={file.url} target="_blank" rel="noreferrer"
                  className="text-xs hover:underline" style={{ color: `${color}aa` }}>
                  {file.name}
                </a>
              ))}
            </div>
            {result.taskUrl && (
              <a href={result.taskUrl} target="_blank" rel="noreferrer"
                className="text-xs text-white/25 hover:text-white/40">
                View in Manus
              </a>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Routes parsed JSON to the correct preset component
const PresetRouter: React.FC<{ data: any }> = ({ data }) => {
  switch (data.display) {
    case "stat_card":
      return <StatCard data={data} />
    case "comparison":
      return <ComparisonCard data={data} />
    case "profile":
      return <ProfileCard data={data} />
    case "verdict":
      return <VerdictCard data={data} />
    case "checklist":
      return <ChecklistCard data={data} />
    case "pipeline":
      return <PipelineCard data={data} />
    case "chart":
      return <ChartCard data={data} />
    default:
      // Unknown display type — render fields generically
      return (
        <div className="space-y-2">
          {data.title && <div className="text-base font-medium text-white/90">{data.title}</div>}
          {data.fields?.map((f: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-white/40 shrink-0 min-w-[100px]">{f.label}:</span>
              <span className="text-white/80">{f.value}</span>
            </div>
          ))}
          {data.summary && <div className="text-sm text-white/60">{data.summary}</div>}
          {data.actions?.map((a: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs text-white/50">
              <span className="text-white/30">•</span><span>{a}</span>
            </div>
          ))}
        </div>
      )
  }
}

export default ToolResultCard
