import React from "react"

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
    case "slides": return <SlidesPreset d={data} color={color} />
    default: return <FallbackPreset d={data} />
  }
}

// ── Stat Card ───────────────────────────────────────────
// Dominant element: huge number + tall sparkline
const StatPreset: React.FC<{ d: any; color: string }> = ({ d, color: _color }) => {
  const sentColor = d.sentiment === "positive" ? "#4ade80" : d.sentiment === "negative" ? "#f87171" : "#4169E1"
  const trend = d.trend as number[] | undefined

  return (
    <div className="space-y-3">
      <div className="text-4xl font-black tracking-tight" style={{ color: sentColor }}>{d.value}</div>
      <div className="text-sm text-white/40">{d.label}</div>
      {trend && trend.length > 1 && (
        <div className="flex items-end gap-1" style={{ height: 48 }}>
          {(() => {
            const min = Math.min(...trend)
            const max = Math.max(...trend)
            const range = max - min
            return trend.map((v: number, i: number) => {
              const pct = range > 0 ? 15 + ((v - min) / range) * 85 : 50
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%" }}>
                  <div className="text-[9px] text-white/20 font-mono mb-1">{v}</div>
                  <div className="w-full rounded-sm" style={{ height: `${pct}%`, background: sentColor, opacity: 0.5 + (i / trend.length) * 0.5 }} />
                </div>
              )
            })
          })()}
        </div>
      )}
      {d.context && <div className="text-xs text-white/30">{d.context}</div>}
      {d.source && <div className="text-[10px] text-white/15">{d.source}</div>}
    </div>
  )
}

// ── Comparison ──────────────────────────────────────────
// Dominant element: thick dual bars with scores
const ComparisonPreset: React.FC<{ d: any }> = ({ d }) => {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm font-bold uppercase tracking-wider">
        <span className="text-green-600">{d.us_name}</span>
        <span className="text-red-500">{d.them_name}</span>
      </div>
      <div className="space-y-2.5">
        {(d.metrics || []).slice(0, 6).map((m: any, i: number) => {
          const usWins = m.us_score >= m.them_score
          return (
            <div key={i}>
              <div className="text-[11px] text-white/40 mb-1 font-medium">{m.label}</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-4 rounded bg-white/5 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${m.us_score * 10}%`, background: usWins ? "#4ade80" : "#4ade8044" }} />
                  </div>
                  <span className="text-xs text-white/50 font-mono w-5 text-right">{m.us_score}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-4 rounded bg-white/5 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${m.them_score * 10}%`, background: !usWins ? "#f87171" : "#f8717144" }} />
                  </div>
                  <span className="text-xs text-white/50 font-mono w-5 text-right">{m.them_score}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {d.verdict && <div className="text-sm text-white/50 pt-3 border-t border-white/7">{d.verdict}</div>}
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────
// Dominant element: large name + colored initial avatar
const ProfilePreset: React.FC<{ d: any }> = ({ d }) => {
  const sentColor = d.sentiment === "positive" ? "#4ade80" : d.sentiment === "negative" ? "#f87171" : d.sentiment === "neutral" ? "#4169E1" : "#666"
  const initial = (d.name || "?")[0].toUpperCase()
  const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won"]
  const stageIdx = d.deal_stage ? stages.indexOf(d.deal_stage.toLowerCase()) : -1

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-black shrink-0"
          style={{ background: `${sentColor}20`, color: sentColor }}>
          {initial}
        </div>
        <div>
          <div className="text-lg font-bold text-white/90">{d.name}</div>
          <div className="text-sm text-white/30">{d.role}{d.company ? ` · ${d.company}` : ""}</div>
        </div>
      </div>
      {d.details && d.details.length > 0 && (
        <div className="space-y-1 pl-1">
          {(d.details as string[]).slice(0, 5).map((detail: string, i: number) => (
            <div key={i} className="text-sm text-white/50 flex items-start gap-2">
              <span className="text-white/15 shrink-0">—</span>
              {detail}
            </div>
          ))}
        </div>
      )}
      {stageIdx >= 0 && (
        <div className="flex items-center gap-1">
          {stages.map((_, i) => (
            <div key={i} className="flex-1 h-2 rounded-full" style={{ background: i <= stageIdx ? "#4ade80" : "rgba(255,255,255,0.05)" }} />
          ))}
        </div>
      )}
      {d.summary && <div className="text-sm text-white/40 italic">{d.summary}</div>}
    </div>
  )
}

// ── Verdict ─────────────────────────────────────────────
// Dominant element: huge colored verdict badge
const VerdictPreset: React.FC<{ d: any }> = ({ d }) => {
  const colors: Record<string, string> = {
    true: "#4ade80", false: "#f87171", partially_true: "#facc15", unverifiable: "#666",
  }
  const labels: Record<string, string> = {
    true: "TRUE", false: "FALSE", partially_true: "PARTIAL", unverifiable: "UNVERIFIABLE",
  }
  const c = colors[d.verdict] || "#666"

  return (
    <div className="space-y-3">
      <div className="py-4 rounded-lg text-center" style={{ background: `${c}15`, border: `1px solid ${c}33` }}>
        <div className="text-3xl font-black tracking-widest" style={{ color: c }}>{labels[d.verdict] || d.verdict}</div>
        {d.confidence && <div className="text-xs mt-1" style={{ color: `${c}88` }}>{d.confidence} confidence</div>}
      </div>
      <div className="text-sm text-white/40 italic">"{d.claim}"</div>
      <div className="text-sm text-white/50 leading-relaxed">{d.evidence}</div>
      {d.source && <div className="text-[10px] text-white/15">{d.source}</div>}
    </div>
  )
}

// ── Checklist ───────────────────────────────────────────
// Dominant element: colored priority bars (not dots) + checkboxes
const ChecklistPreset: React.FC<{ d: any }> = ({ d }) => {
  const priorityColors: Record<string, string> = { high: "#f87171", medium: "#facc15", low: "#4ade80" }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-base font-bold text-white/90">{d.title}</div>
        {d.subtitle && <div className="text-xs text-white/30 mt-0.5">{d.subtitle}</div>}
      </div>
      {d.context && (
        <div className="space-y-1.5">
          {(d.context as any[]).slice(0, 5).map((c: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <div className="w-1 h-full min-h-[16px] rounded-full shrink-0 mt-0.5" style={{ background: priorityColors[c.priority] || "#facc15" }} />
              <span className="text-white/50">{c.text}</span>
            </div>
          ))}
        </div>
      )}
      {d.items && d.items.length > 0 && (
        <>
          <div className="h-px bg-white/5" />
          <div className="space-y-2">
            {(d.items as any[]).slice(0, 5).map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <span className="w-4 h-4 rounded border-2 border-white/10 shrink-0" />
                <span className="text-white/50">{item.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Pipeline ────────────────────────────────────────────
// Dominant element: thick stage segments with current highlighted
const PipelinePreset: React.FC<{ d: any }> = ({ d }) => {
  const riskColor = d.risk === "low" ? "#4ade80" : d.risk === "high" ? "#f87171" : "#facc15"
  const stages = d.stages || []
  const current = d.current_stage || 0

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-lg font-bold text-white/90">{d.client}</span>
        {d.deal_value && <span className="text-base font-mono text-white/50">{d.deal_value}</span>}
      </div>
      {stages.length > 0 && (
        <div>
          <div className="flex gap-1">
            {stages.map((_: string, i: number) => (
              <div key={i} className="flex-1 h-4 rounded" style={{
                background: i < current ? "#224D8F" : i === current ? "#4169E1" : "rgba(255,255,255,0.05)",
                border: i === current ? "1px solid #4169E1" : i < current ? "1px solid #1E3A8A" : "1px solid transparent",
              }} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-white/20 mt-1.5">
            {stages.map((s: string, i: number) => (
              <span key={i} className={i === current ? "font-bold" : ""} style={{ flex: 1, textAlign: "center", color: i === current ? "#4169E1" : undefined }}>{s}</span>
            ))}
          </div>
        </div>
      )}
      {d.next_action && (
        <div className="p-3 rounded-lg bg-white/[0.03] border border-white/7">
          <div className="text-sm font-semibold text-white/90">{d.next_action}</div>
          {d.next_action_due && <div className="text-xs text-white/30 mt-1">Due: {d.next_action_due}</div>}
        </div>
      )}
      <div className="flex items-center gap-4 text-xs">
        {d.blockers && d.blockers.length > 0 && (
          <span className="text-red-500/80">⚠ {d.blockers[0]}</span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: riskColor }} />
          <span className="font-medium" style={{ color: riskColor }}>{d.risk} risk</span>
        </span>
      </div>
    </div>
  )
}

// ── Chart ───────────────────────────────────────────────
const ChartPreset: React.FC<{ d: any; color: string }> = ({ d, color }) => {
  const ds = d.datasets?.[0]
  if (!ds) return <div className="text-sm text-white/40">No data</div>

  const resolveColor = (c?: string) => {
    const map: Record<string, string> = { blue: "#4169E1", green: "#4ade80", red: "#f87171", orange: "#fb923c", purple: "#a78bfa", cyan: "#22d3ee", gray: "#666" }
    return map[c || "blue"] || c || color
  }

  // Donut — larger circle, bolder legend
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
        <div className="text-sm font-medium text-white/40">{d.title}</div>
        <div className="flex items-center gap-5">
          <div className="w-24 h-24 rounded-full shrink-0" style={{
            background: `conic-gradient(${segs.join(", ")})`,
            mask: "radial-gradient(circle, transparent 36%, black 38%)",
            WebkitMask: "radial-gradient(circle, transparent 36%, black 38%)",
          }} />
          <div className="space-y-1.5">
            {ds.values.map((v: number, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-sm" style={{ background: colors[i] }} />
                <span className="text-white/40">{labels[i]}</span>
                <span className="text-white/90 font-mono font-bold">{Math.round((v / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        {d.summary && <div className="text-xs text-white/40">{d.summary}</div>}
      </div>
    )
  }

  // Bar chart — taller, bolder
  const min = Math.min(...ds.values)
  const max = Math.max(...ds.values, 1)
  const range = max - min
  const labels = d.labels || ds.values.map((_: number, i: number) => String(i))
  const barColor = resolveColor(ds.color)

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-white/40">{d.title}</div>
      <div className="flex items-end gap-1.5" style={{ height: 100 }}>
        {ds.values.map((v: number, i: number) => {
          const pct = range > 0 ? 10 + ((v - min) / range) * 90 : 50
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%" }}>
              <span className="text-[10px] text-white/40 font-mono mb-1">{v}</span>
              <div className="w-full rounded-t" style={{ height: `${pct}%`, background: barColor, minHeight: 4 }} />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1.5">
        {labels.map((label: string, i: number) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[10px] text-white/25">{label}</span>
          </div>
        ))}
      </div>
      {d.summary && <div className="text-xs text-white/40 pt-1">{d.summary}</div>}
    </div>
  )
}

// ── Slides ──────────────────────────────────────────────
const SlidesPreset: React.FC<{ d: any; color: string }> = ({ d, color }) => {
  const [currentSlide, setCurrentSlide] = React.useState(0)
  const slides = d.slides || []
  const [isHovered, setIsHovered] = React.useState(false)

  React.useEffect(() => {
    if (!isHovered) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && currentSlide < slides.length - 1) {
        setCurrentSlide(prev => prev + 1)
      } else if (e.key === "ArrowLeft" && currentSlide > 0) {
        setCurrentSlide(prev => prev - 1)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [isHovered, currentSlide, slides.length])

  if (slides.length === 0) return <div className="text-sm text-white/40">No slides</div>

  const slide = slides[currentSlide]

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {d.title && <div className="text-sm font-medium text-white/40 mb-3">{d.title}</div>}

      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/7 min-h-[100px]">
        <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color }}>
          {slide.heading}
          <span className="text-white/15 ml-2 font-normal">{currentSlide + 1}/{slides.length}</span>
        </div>
        <div className="space-y-1.5">
          {(slide.bullets || []).map((bullet: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-white/15 mt-0.5 shrink-0">—</span>
              <span className="text-white/50">{bullet}</span>
            </div>
          ))}
        </div>
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <button
            onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
            className="text-white/15 hover:text-white/40 text-sm px-1"
            disabled={currentSlide === 0}
          >
            ‹
          </button>
          {slides.map((_: any, i: number) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentSlide ? "bg-white/50" : "bg-white/10 hover:bg-white/20"
              }`}
            />
          ))}
          <button
            onClick={() => setCurrentSlide(prev => Math.min(slides.length - 1, prev + 1))}
            className="text-white/15 hover:text-white/40 text-sm px-1"
            disabled={currentSlide === slides.length - 1}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}

// ── Fallback ────────────────────────────────────────────
const FallbackPreset: React.FC<{ d: any }> = ({ d }) => (
  <div className="space-y-2">
    {d.title && <div className="text-base font-medium text-white/90">{d.title}</div>}
    {d.fields?.map((f: any, i: number) => (
      <div key={i} className="flex gap-2 text-sm">
        <span className="text-white/20 min-w-[80px]">{f.label}:</span>
        <span className="text-white/50">{f.value}</span>
      </div>
    ))}
    {d.summary && <div className="text-sm text-white/40">{d.summary}</div>}
  </div>
)

export default PresetRenderer
