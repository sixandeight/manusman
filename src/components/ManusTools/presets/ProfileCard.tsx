import React from "react"

interface ProfileData {
  name: string
  role: string
  company: string
  details?: Array<{ label: string; value: string }>
  deal_stage?: string
  deal_value?: string
  last_contact?: string
  sentiment: "positive" | "negative" | "neutral" | "unknown"
  summary?: string
  actions?: string[]
}

const SENTIMENT = {
  positive: { color: "#4ade80", label: "Positive" },
  negative: { color: "#f87171", label: "At risk" },
  neutral: { color: "#60a5fa", label: "Neutral" },
  unknown: { color: "#666", label: "Unknown" },
}

const STAGE_ORDER = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]

const ProfileCard: React.FC<{ data: ProfileData }> = ({ data }) => {
  const sent = SENTIMENT[data.sentiment] || SENTIMENT.unknown
  const stageIdx = data.deal_stage ? STAGE_ORDER.indexOf(data.deal_stage.toLowerCase()) : -1

  return (
    <div className="space-y-3">
      {/* Name + Role */}
      <div>
        <div className="text-lg font-semibold text-white/95">{data.name}</div>
        <div className="text-sm text-white/50">
          {data.role}{data.company ? ` · ${data.company}` : ""}
        </div>
      </div>

      {/* Sentiment dot */}
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full" style={{ background: sent.color, boxShadow: `0 0 6px ${sent.color}66` }} />
        <span style={{ color: sent.color }}>{sent.label}</span>
        {data.last_contact && <span className="text-white/30">· Last: {data.last_contact}</span>}
      </div>

      {/* Deal stage pipeline */}
      {data.deal_stage && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {STAGE_ORDER.filter(s => s !== "closed_lost").map((stage, i) => (
              <div
                key={stage}
                className="h-1.5 flex-1 rounded-full"
                style={{
                  background: i <= stageIdx ? "#4ade80" : "rgba(255,255,255,0.1)",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-white/30">
            <span>Lead</span>
            <span>{data.deal_stage}{data.deal_value ? ` · ${data.deal_value}` : ""}</span>
            <span>Won</span>
          </div>
        </div>
      )}

      {/* Details */}
      {data.details && data.details.length > 0 && (
        <div className="space-y-1">
          {data.details.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-white/30 shrink-0 min-w-[80px]">{d.label}:</span>
              <span className="text-white/70">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      {data.summary && (
        <div className="text-xs text-white/50 leading-relaxed">{data.summary}</div>
      )}

      {/* Actions */}
      {data.actions && data.actions.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-white/10">
          <div className="text-[10px] text-white/30 uppercase tracking-wider">Next steps</div>
          {data.actions.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-white/60">
              <span className="text-white/30">•</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProfileCard
