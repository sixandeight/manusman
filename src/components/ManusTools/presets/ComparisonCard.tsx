import React from "react"

interface Metric {
  label: string
  us_score: number
  them_score: number
  us_note: string
  them_note: string
}

interface ComparisonData {
  us_name: string
  them_name: string
  metrics: Metric[]
  verdict: string
  actions?: string[]
}

const ScoreBar: React.FC<{ score: number; maxScore?: number; color: string }> = ({ score, maxScore = 10, color }) => {
  const pct = (score / maxScore) * 100
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

const ComparisonCard: React.FC<{ data: ComparisonData }> = ({ data }) => {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
        <span className="text-green-400">{data.us_name}</span>
        <span className="text-red-400">{data.them_name}</span>
      </div>

      {/* Metrics */}
      <div className="space-y-2">
        {data.metrics.slice(0, 8).map((m, i) => (
          <div key={i} className="space-y-1">
            <div className="text-xs text-gray-400">{m.label}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <ScoreBar score={m.us_score} color={m.us_score >= m.them_score ? "#4ade80" : "#f8717166"} />
                <div className="text-[10px] text-gray-400 mt-0.5 truncate">{m.us_note}</div>
              </div>
              <div>
                <ScoreBar score={m.them_score} color={m.them_score > m.us_score ? "#f87171" : "#4ade8066"} />
                <div className="text-[10px] text-gray-400 mt-0.5 truncate text-right">{m.them_note}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Verdict */}
      <div className="text-sm text-gray-700 pt-1 border-t border-gray-100">
        {data.verdict}
      </div>

      {/* Actions */}
      {data.actions && data.actions.length > 0 && (
        <div className="space-y-1">
          {data.actions.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
              <span className="text-gray-300 shrink-0">•</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ComparisonCard
