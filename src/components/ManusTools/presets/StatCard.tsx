import React from "react"

interface StatCardData {
  value: string
  label: string
  unit?: string
  trend?: number[]
  trend_labels?: string[]
  sentiment: "positive" | "negative" | "neutral"
  source?: string
  context?: string
}

const SENTIMENT_COLORS = {
  positive: "#4ade80",
  negative: "#f87171",
  neutral: "#60a5fa",
}

// Mini sparkline rendered as inline SVG
const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 120
  const h = 32
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x},${y}`
  }).join(" ")

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const StatCard: React.FC<{ data: StatCardData }> = ({ data }) => {
  const color = SENTIMENT_COLORS[data.sentiment] || SENTIMENT_COLORS.neutral

  return (
    <div className="space-y-2">
      {/* Big number */}
      <div className="text-3xl font-bold tracking-tight" style={{ color }}>
        {data.value}
      </div>

      {/* Label */}
      <div className="text-sm text-gray-500">{data.label}</div>

      {/* Sparkline */}
      {data.trend && data.trend.length > 1 && (
        <div className="flex items-center gap-3">
          <Sparkline data={data.trend} color={color} />
          {data.trend_labels && (
            <div className="flex gap-2 text-[10px] text-gray-300">
              {data.trend_labels.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Source */}
      {data.source && (
        <div className="text-xs text-gray-300">Source: {data.source}</div>
      )}

      {/* Context */}
      {data.context && (
        <div className="text-xs text-gray-400 leading-relaxed">{data.context}</div>
      )}
    </div>
  )
}

export default StatCard
