import React from "react"

// ── Unified preset renderer ─────────────────────────────
// All presets render directly — no card wrapper, no white bg.
// Dark translucent container is provided by the parent CardView.
// Text is white-on-dark. Simple blocks, no intricate patterns.

interface Props {
  data: any
  color: string
}

const PresetRenderer: React.FC<Props> = ({ data, color }) => {
  switch (data.display) {
    case "stat_card": return <StatPreset d={data} color={color} />
    case "comparison": return <ComparisonPreset d={data} />
    case "profile": return <ProfilePreset d={data} />
    case "verdict": return <VerdictPreset d={data} />
    case "checklist": return <ChecklistPreset d={data} />
    case "pipeline": return <PipelinePreset d={data} />
    case "chart": return <ChartPreset d={data} color={color} />
    default: return <FallbackPreset d={data} />
  }
}

// ── Stat Card ───────────────────────────────────────────
const StatPreset: React.FC<{ d: any; color: string }> = ({ d, color: _color }) => {
  const sentColor = d.sentiment === "positive" ? "#4ade80" : d.sentiment === "negative" ? "#f87171" : "#60a5fa"
  const trend = d.trend as number[] | undefined

  return (
    <div className="space-y-2">
      <div className="text-3xl font-bold" style={{ color: sentColor }}>{d.value}</div>
      {trend && trend.length > 1 && (
        <div className="flex items-end gap-1 h-8">
          {(() => {
            const min = Math.min(...trend)
            const max = Math.max(...trend)
            const range = max - min
            return trend.map((v: number, i: number) => {
              // Normalize to min-max range so differences are visible, with 15% floor
              const pct = range > 0 ? 15 + ((v - min) / range) * 85 : 50
              return <div key={i} className="flex-1 rounded-sm" style={{ height: `${pct}%`, background: sentColor, opacity: 0.6 + (i / trend.length) * 0.4 }} />
            })
          })()}
        </div>
      )}
      <div className="text-sm text-white/50">{d.label}</div>
      {d.source && <div className="text-[10px] text-white/25">{d.source}</div>}
    </div>
  )
}

// ── Comparison ──────────────────────────────────────────
const ComparisonPreset: React.FC<{ d: any }> = ({ d }) => {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
        <span className="text-green-400">{d.us_name}</span>
        <span className="text-red-400">{d.them_name}</span>
      </div>
      <div className="space-y-2">
        {(d.metrics || []).slice(0, 8).map((m: any, i: number) => {
          const usWins = m.us_score >= m.them_score
          return (
            <div key={i}>
              <div className="text-[10px] text-white/40 mb-1">{m.label}</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${m.us_score * 10}%`, background: usWins ? "#4ade80" : "#4ade8044" }} />
                  </div>
                  <span className="text-[10px] text-white/40 w-4">{m.us_score}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${m.them_score * 10}%`, background: !usWins ? "#f87171" : "#f8717144" }} />
                  </div>
                  <span className="text-[10px] text-white/40 w-4">{m.them_score}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {d.verdict && <div className="text-sm text-white/70 pt-2 border-t border-white/10">{d.verdict}</div>}
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────
const ProfilePreset: React.FC<{ d: any }> = ({ d }) => {
  const sentColor = d.sentiment === "positive" ? "#4ade80" : d.sentiment === "negative" ? "#f87171" : d.sentiment === "neutral" ? "#60a5fa" : "#666"
  const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won"]
  const stageIdx = d.deal_stage ? stages.indexOf(d.deal_stage.toLowerCase()) : -1

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-semibold text-white/95">{d.name}</div>
        <div className="text-sm text-white/40">{d.role}{d.company ? ` · ${d.company}` : ""}</div>
      </div>
      {stageIdx >= 0 && (
        <div className="flex items-center gap-1">
          {stages.map((_, i) => (
            <div key={i} className="flex-1 h-1.5 rounded-full" style={{ background: i <= stageIdx ? "#4ade80" : "rgba(255,255,255,0.08)" }} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-white/40">
        {d.last_contact && <span>Last: {d.last_contact}</span>}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ background: sentColor }} />
          {d.sentiment}
        </span>
      </div>
    </div>
  )
}

// ── Verdict ─────────────────────────────────────────────
const VerdictPreset: React.FC<{ d: any }> = ({ d }) => {
  const colors: Record<string, string> = {
    true: "#4ade80", false: "#f87171", partially_true: "#facc15", unverifiable: "#666",
  }
  const labels: Record<string, string> = {
    true: "TRUE", false: "FALSE", partially_true: "PARTIAL", unverifiable: "UNVERIFIABLE",
  }
  const c = colors[d.verdict] || "#666"

  return (
    <div className="space-y-3 text-center">
      <div className="py-3 rounded-lg" style={{ background: `${c}15` }}>
        <div className="text-2xl font-black tracking-widest" style={{ color: c }}>{labels[d.verdict] || d.verdict}</div>
      </div>
      <div className="text-sm text-white/50 italic">"{d.claim}"</div>
      <div className="text-sm text-white/70">{d.evidence}</div>
      {d.source && <div className="text-[10px] text-white/25">{d.source}</div>}
    </div>
  )
}

// ── Checklist ───────────────────────────────────────────
const ChecklistPreset: React.FC<{ d: any }> = ({ d }) => {
  const priorityColors: Record<string, string> = { high: "#f87171", medium: "#facc15", low: "#4ade80" }

  return (
    <div className="space-y-3">
      <div className="text-base font-semibold text-white/90">{d.title}</div>
      {d.context && (
        <div className="space-y-1">
          {(d.context as any[]).map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: priorityColors[c.priority] || "#facc15" }} />
              <span className="text-white/70">{c.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="h-px bg-white/10" />
      {d.items && (
        <div className="space-y-1.5">
          {(d.items as any[]).map((item: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-4 h-4 rounded border border-white/20 shrink-0 flex items-center justify-center text-[10px] text-white/20" />
              <span className="text-white/60">{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Pipeline ────────────────────────────────────────────
const PipelinePreset: React.FC<{ d: any }> = ({ d }) => {
  const riskColor = d.risk === "low" ? "#4ade80" : d.risk === "high" ? "#f87171" : "#facc15"
  const stages = d.stages || []
  const current = d.current_stage || 0

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-base font-semibold text-white/90">{d.client}</span>
        {d.deal_value && <span className="text-sm font-mono text-white/50">{d.deal_value}</span>}
      </div>
      {stages.length > 0 && (
        <div>
          <div className="flex gap-1">
            {stages.map((_: string, i: number) => (
              <div key={i} className="flex-1 h-2 rounded-full" style={{ background: i <= current ? (i === current ? "#60a5fa" : "#60a5fa88") : "rgba(255,255,255,0.08)" }} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-white/25 mt-1">
            {stages.map((s: string, i: number) => (
              <span key={i} className={i === current ? "text-blue-400 font-bold" : ""}>{s}</span>
            ))}
          </div>
        </div>
      )}
      {d.next_action && (
        <div className="p-2 rounded-md bg-white/5 border border-white/10">
          <div className="text-sm font-medium text-white/90">{d.next_action}</div>
          {d.next_action_due && <div className="text-[10px] text-white/30 mt-1">Due: {d.next_action_due}</div>}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs">
        {d.blockers && d.blockers.length > 0 && (
          <span className="text-red-400/70">! {d.blockers[0]}</span>
        )}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ background: riskColor }} />
          <span style={{ color: riskColor }}>{d.risk}</span>
        </span>
      </div>
    </div>
  )
}

// ── Chart ───────────────────────────────────────────────
const ChartPreset: React.FC<{ d: any; color: string }> = ({ d, color }) => {
  const ds = d.datasets?.[0]
  if (!ds) return <div className="text-sm text-white/50">No data</div>

  const resolveColor = (c?: string) => {
    const map: Record<string, string> = { blue: "#60a5fa", green: "#4ade80", red: "#f87171", orange: "#fb923c", purple: "#a78bfa", cyan: "#22d3ee", gray: "#666" }
    return map[c || "blue"] || c || color
  }

  if (d.chart_type === "donut") {
    const total = ds.values.reduce((a: number, b: number) => a + b, 0)
    const labels = ds.labels || d.labels || []
    const colors = (ds.colors || []).map(resolveColor)
    let cum = 0
    const segs = ds.values.map((v: number, i: number) => {
      const pct = (v / total) * 100
      const s = `${colors[i] || resolveColor("blue")} ${cum}% ${cum + pct}%`
      cum += pct
      return s
    })

    return (
      <div className="space-y-3">
        <div className="text-sm font-medium text-white/70">{d.title}</div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full shrink-0" style={{
            background: `conic-gradient(${segs.join(", ")})`,
            mask: "radial-gradient(circle, transparent 38%, black 40%)",
            WebkitMask: "radial-gradient(circle, transparent 38%, black 40%)",
          }} />
          <div className="space-y-1">
            {ds.values.map((v: number, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ background: colors[i] }} />
                <span className="text-white/40">{labels[i]}</span>
                <span className="text-white/60 font-mono">{Math.round((v / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        {d.summary && <div className="text-xs text-white/50">{d.summary}</div>}
      </div>
    )
  }

  // Bar / Line chart
  const min = Math.min(...ds.values)
  const max = Math.max(...ds.values, 1)
  const range = max - min
  const labels = d.labels || ds.values.map((_: number, i: number) => String(i))
  const barColor = resolveColor(ds.color)

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-white/70">{d.title}</div>
      {/* Value labels */}
      <div className="flex gap-1">
        {ds.values.map((v: number, i: number) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[10px] text-white/50 font-mono">{v}</span>
          </div>
        ))}
      </div>
      {/* Bars */}
      <div className="flex items-end gap-1" style={{ height: 80 }}>
        {ds.values.map((v: number, i: number) => {
          const pct = range > 0 ? 10 + ((v - min) / range) * 90 : 50
          return (
            <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${pct}%`, background: barColor, minHeight: 4 }} />
          )
        })}
      </div>
      {/* Axis labels */}
      <div className="flex gap-1">
        {labels.map((label: string, i: number) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[10px] text-white/30">{label}</span>
          </div>
        ))}
      </div>
      {d.summary && <div className="text-xs text-white/50 pt-1">{d.summary}</div>}
    </div>
  )
}

// ── Fallback ────────────────────────────────────────────
const FallbackPreset: React.FC<{ d: any }> = ({ d }) => (
  <div className="space-y-2">
    {d.title && <div className="text-base font-medium text-white/90">{d.title}</div>}
    {d.fields?.map((f: any, i: number) => (
      <div key={i} className="flex gap-2 text-sm">
        <span className="text-white/30 min-w-[80px]">{f.label}:</span>
        <span className="text-white/70">{f.value}</span>
      </div>
    ))}
    {d.summary && <div className="text-sm text-white/50">{d.summary}</div>}
  </div>
)

export default PresetRenderer
