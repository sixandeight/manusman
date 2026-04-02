import React from "react"

interface Dataset {
  name: string
  values: number[]
  labels?: string[]
  color?: string
  colors?: string[]
}

interface Annotation {
  index: number
  text: string
}

interface ChartData {
  chart_type: "bar" | "line" | "donut" | "horizontal_bar"
  title: string
  x_label?: string
  y_label?: string
  datasets: Dataset[]
  labels?: string[]
  annotations?: Annotation[]
  summary: string
  source?: string
}

const COLOR_MAP: Record<string, string> = {
  blue: "#60a5fa",
  green: "#4ade80",
  red: "#f87171",
  orange: "#fb923c",
  purple: "#a78bfa",
  cyan: "#22d3ee",
  gray: "#666",
}

const resolve = (c?: string) => COLOR_MAP[c || "blue"] || c || COLOR_MAP.blue

// Simple bar chart rendered as CSS bars
const BarChart: React.FC<{ data: ChartData }> = ({ data }) => {
  const ds = data.datasets[0]
  if (!ds) return null
  const max = Math.max(...ds.values, 1)
  const labels = data.labels || ds.values.map((_, i) => String(i))
  const color = resolve(ds.color)

  return (
    <div className="space-y-1">
      {ds.values.map((v, i) => {
        const pct = (v / max) * 100
        const annotation = data.annotations?.find(a => a.index === i)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 w-12 text-right shrink-0 truncate">{labels[i]}</span>
            <div className="flex-1 h-4 rounded bg-white/5 overflow-hidden relative">
              <div
                className="h-full rounded transition-all duration-500"
                style={{ width: `${pct}%`, background: color }}
              />
              {annotation && (
                <span className="absolute right-1 top-0 text-[9px] text-white/50 leading-4">{annotation.text}</span>
              )}
            </div>
            <span className="text-[10px] text-white/50 w-16 shrink-0 font-mono">
              {typeof v === "number" && v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` :
               typeof v === "number" && v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Donut chart as CSS conic-gradient
const DonutChart: React.FC<{ data: ChartData }> = ({ data }) => {
  const ds = data.datasets[0]
  if (!ds) return null
  const total = ds.values.reduce((a, b) => a + b, 0)
  const labels = ds.labels || data.labels || ds.values.map((_, i) => `Slice ${i + 1}`)
  const colors = ds.colors?.map(resolve) || ds.values.map((_, i) => resolve(["blue", "green", "orange", "purple", "cyan", "red", "gray"][i]))

  // Build conic gradient
  let cumPct = 0
  const segments = ds.values.map((v, i) => {
    const pct = (v / total) * 100
    const seg = `${colors[i]} ${cumPct}% ${cumPct + pct}%`
    cumPct += pct
    return seg
  })

  return (
    <div className="flex items-center gap-4">
      <div
        className="w-16 h-16 rounded-full shrink-0"
        style={{
          background: `conic-gradient(${segments.join(", ")})`,
          mask: "radial-gradient(circle at center, transparent 40%, black 41%)",
          WebkitMask: "radial-gradient(circle at center, transparent 40%, black 41%)",
        }}
      />
      <div className="space-y-0.5">
        {ds.values.map((v, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colors[i] }} />
            <span className="text-white/50">{labels[i]}</span>
            <span className="text-white/70 font-mono">{Math.round((v / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ChartCard: React.FC<{ data: ChartData }> = ({ data }) => {
  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="text-sm font-medium text-white/80">{data.title}</div>

      {/* Chart */}
      {(data.chart_type === "bar" || data.chart_type === "line" || data.chart_type === "horizontal_bar") && (
        <BarChart data={data} />
      )}
      {data.chart_type === "donut" && (
        <DonutChart data={data} />
      )}

      {/* Summary */}
      <div className="text-xs text-white/60 leading-relaxed">{data.summary}</div>

      {/* Source */}
      {data.source && (
        <div className="text-[10px] text-white/30">Source: {data.source}</div>
      )}
    </div>
  )
}

export default ChartCard
