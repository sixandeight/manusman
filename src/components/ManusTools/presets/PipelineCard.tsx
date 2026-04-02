import React from "react"

interface PipelineData {
  client: string
  stages: string[]
  current_stage: number
  deal_value?: string
  risk: "low" | "medium" | "high"
  next_action: string
  next_action_due?: string
  blockers?: string[]
  last_activity?: string
  summary?: string
}

const RISK_COLORS = {
  low: "#4ade80",
  medium: "#facc15",
  high: "#f87171",
}

const PipelineCard: React.FC<{ data: PipelineData }> = ({ data }) => {
  const riskColor = RISK_COLORS[data.risk] || RISK_COLORS.medium

  return (
    <div className="space-y-3">
      {/* Client + Value */}
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-gray-800">{data.client}</div>
        {data.deal_value && (
          <div className="text-sm font-mono text-gray-500">{data.deal_value}</div>
        )}
      </div>

      {/* Stage dots */}
      <div className="space-y-1.5">
        <div className="flex gap-1">
          {data.stages.map((_, i) => (
            <div
              key={i}
              className="h-2 flex-1 rounded-full transition-all"
              style={{
                background: i <= data.current_stage
                  ? (i === data.current_stage ? "#60a5fa" : "#60a5fa88")
                  : "rgba(0,0,0,0.06)",
              }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-gray-300">
          {data.stages.map((s, i) => (
            <span key={i} className={i === data.current_stage ? "text-blue-400 font-bold" : ""}>
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Next action — prominent */}
      <div className="p-2 rounded-md bg-gray-50">
        <div className="text-[10px] text-gray-300 uppercase tracking-wider mb-1">Next action</div>
        <div className="text-sm font-medium text-gray-800">{data.next_action}</div>
        {data.next_action_due && (
          <div className="text-xs text-gray-400 mt-0.5">Due: {data.next_action_due}</div>
        )}
      </div>

      {/* Risk */}
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full" style={{ background: riskColor, boxShadow: `0 0 6px ${riskColor}66` }} />
        <span style={{ color: riskColor }}>Risk: {data.risk}</span>
      </div>

      {/* Blockers */}
      {data.blockers && data.blockers.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-red-400/60 uppercase tracking-wider">Blockers</div>
          {data.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-300/60">
              <span className="shrink-0">!</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Last activity */}
      {data.last_activity && (
        <div className="text-xs text-gray-300">Last: {data.last_activity}</div>
      )}
    </div>
  )
}

export default PipelineCard
