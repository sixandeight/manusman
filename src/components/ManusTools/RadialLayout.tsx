import React, { useEffect, useState, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import PresetRenderer from "./PresetRenderer"
import { PhysicsEngine, findLinks } from "./PhysicsEngine"

// ── Types ───────────────────────────────────────────────

type Phase = "input" | "pending" | "thinking" | "complete"

interface Card {
  id: string
  toolName: string
  needsScreenshot: boolean
  phase: Phase
  query: string
  result: any | null
  parsedResult: any | null
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

// Parse result JSON — extract JSON from anywhere in text
function parseResultJSON(text: string): any | null {
  if (!text) return null
  // Strategy 1: extract ```json ... ``` block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch {}
  }
  // Strategy 2: find { ... "display" ... } object
  const jsonMatch = text.match(/\{[\s\S]*"display"\s*:\s*"[^"]+[\s\S]*\}/)
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]) } catch {}
  }
  // Strategy 3: whole text as JSON
  try { return JSON.parse(text.trim()) } catch {}
  return null
}

// ── Auto-fade hook ─────────────────────────────────────

const FADE_DELAY = 30000   // 30s before fade starts
const FADE_DURATION = 15000 // 15s fade

function useAutoFade(
  phase: Phase,
  onDeleteRef: React.MutableRefObject<() => void>,
): { opacity: number; onHover: () => void; onLeave: () => void } {
  const [opacity, setOpacity] = useState(1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeStartRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const hoveredRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    timerRef.current = null
    fadeStartRef.current = null
  }, [])

  const startFadeTimer = useCallback(() => {
    clearTimers()
    timerRef.current = setTimeout(() => {
      fadeStartRef.current = Date.now()
      const tick = () => {
        if (hoveredRef.current) return
        const elapsed = Date.now() - (fadeStartRef.current || Date.now())
        const progress = Math.min(elapsed / FADE_DURATION, 1)
        setOpacity(1 - progress)
        if (progress >= 1) {
          onDeleteRef.current()
        } else {
          rafRef.current = requestAnimationFrame(tick)
        }
      }
      tick()
    }, FADE_DELAY)
  }, [clearTimers, onDeleteRef])

  // Start timer when phase becomes complete — only trigger on phase change
  useEffect(() => {
    if (phase === "complete") {
      startFadeTimer()
    }
    return clearTimers
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const onHover = useCallback(() => {
    hoveredRef.current = true
    clearTimers()
    setOpacity(1)
  }, [clearTimers])

  const onLeave = useCallback(() => {
    hoveredRef.current = false
    if (phase === "complete") {
      startFadeTimer()
    }
  }, [phase, startFadeTimer])

  return { opacity, onHover, onLeave }
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

  // Stable ref for delete callback — avoids stale closure in useAutoFade
  const onDeleteRef = useRef(() => onDismiss(card.id))
  onDeleteRef.current = () => onDismiss(card.id)

  const { opacity, onHover, onLeave } = useAutoFade(card.phase, onDeleteRef)

  useEffect(() => { if (card.phase === "input") inputRef.current?.focus() }, [card.phase])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const args = buildArgs(card.toolName, card.query)
    let ss: string | undefined
    if (card.needsScreenshot) ss = await window.electronAPI.getLastScreenshotPath() || undefined
    onSubmit(card.id, card.toolName, args, ss)
  }

  const phaseLabel = card.phase === "pending" ? "pending" : card.phase === "thinking" ? "thinking" : ""
  const parsed = card.parsedResult

  return (
    <div
      style={{ opacity, transition: "opacity 0.3s ease" }}
      onMouseEnter={() => {
        onHover()
        window.electronAPI.setIgnoreMouse(false)
      }}
      onMouseLeave={() => {
        onLeave()
        window.electronAPI.setIgnoreMouse(true)
      }}
    >
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "rgba(0, 0, 0, 0.65)",
          borderLeft: `3px solid ${color}`,
          boxShadow: `0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06)`,
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
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const queues = useRef<Map<string, string[]>>(new Map())
  const processedResults = useRef<Set<string>>(new Set())
  const physicsRef = useRef<PhysicsEngine | null>(null)
  const dragOverride = useRef<Map<string, { x: number; y: number }>>(new Map())

  // Initialize physics engine
  useEffect(() => {
    const engine = new PhysicsEngine(
      window.innerWidth,
      window.innerHeight,
      (newPositions) => {
        setPositions(prev => {
          const next = new Map(prev)
          for (const [id, pos] of newPositions) {
            // Don't override dragged cards
            if (!dragOverride.current.has(id)) {
              next.set(id, pos)
            }
          }
          return next
        })
      }
    )
    physicsRef.current = engine
    return () => engine.destroy()
  }, [])

  // New prompt → create input card
  useEffect(() => {
    if (!activeToolPrompt) return
    const id = nextId(activeToolPrompt.toolName)
    setCards(prev => new Map(prev).set(id, {
      id, toolName: activeToolPrompt.toolName, needsScreenshot: activeToolPrompt.needsScreenshot,
      phase: "input", query: "", result: null, parsedResult: null,
    }))
    physicsRef.current?.addNode(id, 300, 80)
    onToolCancel()
  }, [activeToolPrompt])

  // Running tools → update existing cards phase
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

  // Results → upgrade EXISTING card to complete + run entity linker
  useEffect(() => {
    if (toolResults.length === 0) return

    console.log(`[RadialLayout] Processing ${toolResults.length} results, cards: ${cards.size}, queues:`, Object.fromEntries(queues.current))

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
        console.log(`[RadialLayout] Result for "${result.toolName}" → queue:`, q, `cardId:`, cardId, `cardExists:`, cardId ? next.has(cardId) : false)
        if (cardId && next.has(cardId)) {
          const card = next.get(cardId)!
          const parsed = parseResultJSON(result.text)
          next.set(cardId, { ...card, phase: "complete", result, parsedResult: parsed })
          physicsRef.current?.updateNodeSize(cardId, 480, 300)
          changed = true
        }
      }

      // Run entity linker on all complete cards
      if (changed) {
        const cardData = Array.from(next.values())
          .filter(c => c.phase === "complete")
          .map(c => ({
            id: c.id,
            toolName: c.toolName,
            query: c.query,
            parsedResult: c.parsedResult,
            resultText: c.result?.text || "",
          }))
        const links = findLinks(cardData)
        physicsRef.current?.updateLinks(links)
      }

      return changed ? next : prev
    })
  }, [toolResults])

  const handleSubmit = useCallback((cardId: string, toolName: string, args: Record<string, string>, screenshot?: string) => {
    const q = queues.current.get(toolName) || []
    q.push(cardId)
    queues.current.set(toolName, q)
    console.log(`[RadialLayout] Submit: ${toolName} → cardId: ${cardId}, queue now:`, [...q])
    setCards(prev => { const n = new Map(prev); const c = n.get(cardId); if (c) n.set(cardId, { ...c, phase: "pending" }); return n })
    onToolSubmit(toolName, args, screenshot)
  }, [onToolSubmit])

  const handleQuery = useCallback((id: string, q: string) => {
    setCards(prev => { const n = new Map(prev); const c = n.get(id); if (c) n.set(id, { ...c, query: q }); return n })
  }, [])

  const handleDismiss = useCallback((id: string) => {
    setCards(prev => { const n = new Map(prev); n.delete(id); return n })
    setPositions(prev => { const n = new Map(prev); n.delete(id); return n })
    physicsRef.current?.removeNode(id)
    dragOverride.current.delete(id)
  }, [])

  // Drag handler — override physics position while dragging
  const handleDrag = useCallback((id: string, x: number, y: number) => {
    dragOverride.current.set(id, { x, y })
    setPositions(prev => new Map(prev).set(id, { x, y }))
  }, [])

  const handleDragEnd = useCallback((_id: string) => {
    // Keep drag override — user's manual position persists
    // Physics won't move the card back
  }, [])

  return (
    <div className="fixed inset-0" style={{ pointerEvents: "none" }}>
      <AnimatePresence>
        {Array.from(cards.values()).map(card => {
          const pos = positions.get(card.id) || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          return (
            <motion.div
              key={card.id}
              className="absolute"
              style={{ left: pos.x, top: pos.y, pointerEvents: "auto", zIndex: 50 }}
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 100, damping: 18, mass: 2 }}
              onMouseDown={(e) => {
                // Drag by header (top 32px)
                const rect = e.currentTarget.getBoundingClientRect()
                if (e.clientY - rect.top > 32) return
                e.preventDefault()
                const startX = e.clientX
                const startY = e.clientY
                const startPos = { ...pos }
                window.electronAPI.setIgnoreMouse(false)
                const move = (ev: MouseEvent) => {
                  handleDrag(card.id, startPos.x + ev.clientX - startX, startPos.y + ev.clientY - startY)
                }
                const up = () => {
                  handleDragEnd(card.id)
                  document.removeEventListener("mousemove", move)
                  document.removeEventListener("mouseup", up)
                }
                document.addEventListener("mousemove", move)
                document.addEventListener("mouseup", up)
              }}
            >
              <CardView card={card} onSubmit={handleSubmit} onDismiss={handleDismiss} onQueryChange={handleQuery} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export default RadialLayout
