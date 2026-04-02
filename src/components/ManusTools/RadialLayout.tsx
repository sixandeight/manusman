import React, { useEffect, useState, useCallback, useRef } from "react"
import PresetRenderer from "./PresetRenderer"

// ── Position allocation ─────────────────────────────────

interface CardPosition { x: number; y: number; width: number; height: number }

function findOpenPosition(existing: Map<string, CardPosition>, w: number, h: number): { x: number; y: number } {
  const screenW = window.innerWidth
  const screenH = window.innerHeight
  const pad = 16
  const startX = screenW - w - pad * 3
  const startY = pad * 4

  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 6; row++) {
      const x = startX - col * (w + pad)
      const y = startY + row * (h + pad)
      if (x < 0 || y + h > screenH) continue
      let overlaps = false
      for (const pos of existing.values()) {
        if (x < pos.x + pos.width + pad && x + w + pad > pos.x && y < pos.y + pos.height + pad && y + h + pad > pos.y) {
          overlaps = true; break
        }
      }
      if (!overlaps) return { x, y }
    }
  }
  return { x: startX - existing.size * 30, y: startY + existing.size * 30 }
}

// ── Types ───────────────────────────────────────────────

type Phase = "input" | "pending" | "thinking" | "complete"

interface Card {
  id: string
  toolName: string
  needsScreenshot: boolean
  phase: Phase
  query: string
  result: any | null
  position: { x: number; y: number }
}

const TOOL_COLORS: Record<string, string> = {
  who_is_this: "#7c3aed", meeting_brief: "#059669", live_fact_check: "#d97706",
  company_snapshot: "#2563eb", deal_status: "#ea580c", competitive_intel: "#dc2626", number_lookup: "#0891b2",
}
const TOOL_LABELS: Record<string, string> = {
  who_is_this: "PERSON", meeting_brief: "BRIEF", live_fact_check: "FACT CHECK",
  company_snapshot: "COMPANY", deal_status: "DEAL", competitive_intel: "INTEL", number_lookup: "STAT",
}
const INPUT_PLACEHOLDERS: Record<string, string> = {
  who_is_this: "Extra context (optional)...", meeting_brief: "Person or company name...",
  live_fact_check: "Claim to verify...", company_snapshot: "Company name...",
  deal_status: "Client name...", competitive_intel: "Competitor name...", number_lookup: "What stat to find...",
}

function buildArgs(toolName: string, input: string): Record<string, string> {
  switch (toolName) {
    case "meeting_brief": return { person_or_company: input }
    case "company_snapshot": return { company_name: input }
    case "deal_status": return { client_name: input }
    case "number_lookup": return { query: input }
    case "who_is_this": return { context: input || "See attached screenshot" }
    case "live_fact_check": return { claim: input }
    case "competitive_intel": return { competitor_name: input }
    default: return { query: input }
  }
}

let counter = 0
function nextId(tool: string) { return `c-${tool}-${++counter}-${Date.now()}` }

// ── Draggable ───────────────────────────────────────────

const Draggable: React.FC<{
  pos: { x: number; y: number }
  onDrag: (x: number, y: number) => void
  children: React.ReactNode
}> = ({ pos, onDrag, children }) => {
  const ref = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const onDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientY - rect.top > 32) return
    e.preventDefault()
    ref.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    window.electronAPI.setIgnoreMouse(false)
    const move = (ev: MouseEvent) => { if (ref.current) onDrag(ref.current.ox + ev.clientX - ref.current.sx, ref.current.oy + ev.clientY - ref.current.sy) }
    const up = () => { ref.current = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up) }
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", up)
  }, [pos, onDrag])

  return (
    <div className="absolute" style={{ left: pos.x, top: pos.y, pointerEvents: "auto", zIndex: 50 }}
      onMouseDown={onDown}
      onMouseEnter={() => window.electronAPI.setIgnoreMouse(false)}
      onMouseLeave={() => window.electronAPI.setIgnoreMouse(true)}>
      {children}
    </div>
  )
}

// ── Card component ──────────────────────────────────────

const CardView: React.FC<{
  card: Card
  onSubmit: (id: string, tool: string, args: Record<string, string>, screenshot?: string) => void
  onDismiss: (id: string) => void
  onQueryChange: (id: string, q: string) => void
}> = ({ card, onSubmit, onDismiss, onQueryChange }) => {
  const color = TOOL_COLORS[card.toolName] || "#666"
  const label = TOOL_LABELS[card.toolName] || card.toolName
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (card.phase === "input") inputRef.current?.focus() }, [card.phase])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const args = buildArgs(card.toolName, card.query)
    let ss: string | undefined
    if (card.needsScreenshot) ss = await window.electronAPI.getLastScreenshotPath() || undefined
    onSubmit(card.id, card.toolName, args, ss)
  }

  const phaseLabel = card.phase === "pending" ? "pending" : card.phase === "thinking" ? "thinking" : ""

  // Parse result JSON if complete
  let parsed: any = null
  if (card.phase === "complete" && card.result?.text) {
    try {
      const t = card.result.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
      parsed = JSON.parse(t)
    } catch {}
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "rgba(0, 0, 0, 0.75)",
        borderLeft: `3px solid ${color}`,
        boxShadow: `0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)`,
        width: card.phase === "complete" ? 480 : 300,
        transition: "width 400ms ease",
      }}
    >
      {/* Header — drag zone */}
      <div className="flex items-center justify-between px-4 h-8 cursor-grab">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</span>
          {card.phase !== "input" && card.phase !== "complete" && (
            <span className={`w-1.5 h-1.5 rounded-full ${card.phase === "thinking" ? "animate-pulse" : ""}`}
              style={{ background: card.phase === "thinking" ? "#facc15" : "#888" }} />
          )}
          {card.phase === "complete" && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }} />
          )}
        </div>
        <button onClick={() => onDismiss(card.id)} className="text-white/20 hover:text-white/40 text-xs leading-none">x</button>
      </div>

      {/* Input */}
      {card.phase === "input" && (
        <form onSubmit={submit} className="px-4 pb-3">
          <input ref={inputRef} value={card.query}
            onChange={e => onQueryChange(card.id, e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") onDismiss(card.id) }}
            placeholder={INPUT_PLACEHOLDERS[card.toolName]}
            className="w-full px-3 py-2 text-sm text-white bg-white/10 rounded-md border border-white/10 focus:outline-none focus:border-white/20 placeholder-white/30" />
        </form>
      )}

      {/* Pending / Thinking */}
      {(card.phase === "pending" || card.phase === "thinking") && (
        <div className="px-4 pb-3">
          {card.query && <div className="text-sm text-white/50 mb-2">{card.query}</div>}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{
                background: `linear-gradient(90deg, transparent, ${color}88, transparent)`,
                animation: `shimmer ${card.phase === "thinking" ? "1s" : "2.5s"} ease-in-out infinite`,
                width: "100%",
              }} />
            </div>
            <span className="text-[10px] text-white/30">{phaseLabel}</span>
          </div>
        </div>
      )}

      {/* Complete — render preset */}
      {card.phase === "complete" && (
        <div className="px-4 pb-4 pt-1">
          {parsed?.display ? (
            <PresetRenderer data={parsed} color={color} />
          ) : (
            <div className="text-sm text-white/70 leading-relaxed">
              {card.result?.text?.substring(0, 500)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main layout ─────────────────────────────────────────

interface Props {
  toolResults: any[]
  runningTools: Map<string, string>
  activeToolPrompt: { toolName: string; needsScreenshot: boolean } | null
  onToolSubmit: (toolName: string, args: Record<string, string>, screenshotPath?: string) => void
  onToolCancel: () => void
  onDismissResult: (index: number) => void
}

const RadialLayout: React.FC<Props> = ({
  toolResults, runningTools, activeToolPrompt, onToolSubmit, onToolCancel, onDismissResult: _onDismissResult,
}) => {
  const [cards, setCards] = useState<Map<string, Card>>(new Map())
  const posRef = useRef<Map<string, CardPosition>>(new Map())
  const queues = useRef<Map<string, string[]>>(new Map())
  const processedResults = useRef<Set<string>>(new Set())

  // New prompt → create input card
  useEffect(() => {
    if (!activeToolPrompt) return
    const id = nextId(activeToolPrompt.toolName)
    const pos = findOpenPosition(posRef.current, 300, 80)
    posRef.current.set(id, { ...pos, width: 300, height: 80 })
    setCards(prev => new Map(prev).set(id, {
      id, toolName: activeToolPrompt.toolName, needsScreenshot: activeToolPrompt.needsScreenshot,
      phase: "input", query: "", result: null, position: pos,
    }))
    onToolCancel()
  }, [activeToolPrompt])

  // Running tools → update existing cards phase (don't create new ones)
  useEffect(() => {
    setCards(prev => {
      const next = new Map(prev)
      let changed = false
      runningTools.forEach((status, toolName) => {
        const q = queues.current.get(toolName)
        if (!q) return
        for (const cardId of q) {
          const card = next.get(cardId)
          if (card && (card.phase === "pending" || card.phase === "thinking")) {
            const newPhase = (status === "thinking" || status === "running") ? "thinking" : card.phase
            if (card.phase !== newPhase) {
              next.set(cardId, { ...card, phase: newPhase as Phase })
              changed = true
            }
          }
        }
      })
      return changed ? next : prev
    })
  }, [runningTools])

  // Results → upgrade EXISTING card to complete (don't create new card)
  useEffect(() => {
    if (toolResults.length === 0) return

    setCards(prev => {
      const next = new Map(prev)
      let changed = false

      for (const result of toolResults) {
        if (result._partial) continue
        const rKey = result.taskId || `${result.toolName}-${result.text?.substring(0, 20)}`
        if (processedResults.current.has(rKey)) continue
        processedResults.current.add(rKey)

        const q = queues.current.get(result.toolName)
        const cardId = q?.shift()
        if (cardId && next.has(cardId)) {
          const card = next.get(cardId)!
          next.set(cardId, { ...card, phase: "complete", result })
          posRef.current.set(cardId, { ...card.position, width: 480, height: 300 })
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [toolResults])

  const handleSubmit = useCallback((cardId: string, toolName: string, args: Record<string, string>, screenshot?: string) => {
    const q = queues.current.get(toolName) || []
    q.push(cardId)
    queues.current.set(toolName, q)
    setCards(prev => { const n = new Map(prev); const c = n.get(cardId); if (c) n.set(cardId, { ...c, phase: "pending" }); return n })
    onToolSubmit(toolName, args, screenshot)
  }, [onToolSubmit])

  const handleQuery = useCallback((id: string, q: string) => {
    setCards(prev => { const n = new Map(prev); const c = n.get(id); if (c) n.set(id, { ...c, query: q }); return n })
  }, [])

  const handleDrag = useCallback((id: string, x: number, y: number) => {
    setCards(prev => { const n = new Map(prev); const c = n.get(id); if (c) n.set(id, { ...c, position: { x, y } }); return n })
    const p = posRef.current.get(id); if (p) posRef.current.set(id, { ...p, x, y })
  }, [])

  const handleDismiss = useCallback((id: string) => {
    setCards(prev => { const n = new Map(prev); n.delete(id); return n })
    posRef.current.delete(id)
  }, [])

  return (
    <div className="fixed inset-0" style={{ pointerEvents: "none" }}>
      {Array.from(cards.values()).map(card => (
        <Draggable key={card.id} pos={card.position} onDrag={(x, y) => handleDrag(card.id, x, y)}>
          <CardView card={card} onSubmit={handleSubmit} onDismiss={handleDismiss} onQueryChange={handleQuery} />
        </Draggable>
      ))}
    </div>
  )
}

export default RadialLayout
