import React from "react"

interface VerdictData {
  claim: string
  verdict: "true" | "false" | "partially_true" | "unverifiable"
  confidence: "high" | "medium" | "low"
  evidence: string
  source?: string
  source_url?: string
  context?: string
}

const VERDICT_STYLE = {
  true: { color: "#4ade80", label: "TRUE", bg: "rgba(74, 222, 128, 0.1)" },
  false: { color: "#f87171", label: "FALSE", bg: "rgba(248, 113, 113, 0.1)" },
  partially_true: { color: "#facc15", label: "PARTIAL", bg: "rgba(250, 204, 21, 0.1)" },
  unverifiable: { color: "#666", label: "UNVERIFIABLE", bg: "rgba(100, 100, 100, 0.1)" },
}

const CONFIDENCE_DOTS = {
  high: 3,
  medium: 2,
  low: 1,
}

const VerdictCard: React.FC<{ data: VerdictData }> = ({ data }) => {
  const style = VERDICT_STYLE[data.verdict] || VERDICT_STYLE.unverifiable
  const dots = CONFIDENCE_DOTS[data.confidence] || 1

  return (
    <div className="space-y-3">
      {/* Big verdict badge */}
      <div className="flex items-center justify-center py-3 rounded-lg" style={{ background: style.bg }}>
        <span className="text-2xl font-black tracking-widest" style={{ color: style.color }}>
          {style.label}
        </span>
      </div>

      {/* Confidence dots */}
      <div className="flex items-center justify-center gap-1">
        {[1, 2, 3].map(i => (
          <span
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ background: i <= dots ? style.color : "rgba(0,0,0,0.06)" }}
          />
        ))}
        <span className="text-[10px] text-gray-300 ml-2">{data.confidence} confidence</span>
      </div>

      {/* Claim */}
      <div className="text-sm text-gray-500 italic">"{data.claim}"</div>

      {/* Evidence */}
      <div className="text-sm text-gray-700 leading-relaxed">{data.evidence}</div>

      {/* Source */}
      {data.source && (
        <div className="text-xs text-gray-300">
          Source: {data.source_url ? (
            <a href={data.source_url} target="_blank" rel="noreferrer" className="text-blue-400/60 hover:text-blue-400">{data.source}</a>
          ) : data.source}
        </div>
      )}

      {/* Context */}
      {data.context && (
        <div className="text-xs text-gray-400">{data.context}</div>
      )}
    </div>
  )
}

export default VerdictCard
