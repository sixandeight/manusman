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
  isAuto?: boolean
}

const TOOL_COLORS: Record<string, string> = {
  intel: "#2563eb", deal_status: "#ea580c", prep: "#7c3aed", live_fact_check: "#d97706",
}
const TOOL_LABELS: Record<string, string> = {
  intel: "INTEL", deal_status: "DEAL", prep: "PREP", live_fact_check: "FACT CHECK",
}
const INPUT_PLACEHOLDERS: Record<string, string> = {
  intel: "Company, person, or topic...", deal_status: "Client name...",
  prep: "Context (optional)...", live_fact_check: "Claim to verify...",
}

function buildArgs(toolName: string, input: string): Record<string, string> {
  switch (toolName) {
    case "intel": return { query: input }
    case "deal_status": return { client_name: input }
    case "prep": return { context: input || "See attached screenshot" }
    case "live_fact_check": return { claim: input }
    default: return { query: input }
  }
}

let counter = 0
function nextId(tool: string) { return `c-${tool}-${++counter}-${Date.now()}` }

// Shared JSON parser + normalizer — single source of truth for Manus response parsing
import { parseManusResponse } from "../../../shared/parseManusJSON"
import { normalizeCardData } from "../../../shared/normalizeCardData"

function parseResultJSON(text: string, toolName?: string): any | null {
  const result = parseManusResponse(text, toolName)
  if (result.errors.length > 0) {
    console.warn(`[parseManusJSON] ${result.errors.join("; ")}`)
  }
  // Normalize ensures all fields are correct types — no NaN, no null crashes
  return result.data ? normalizeCardData(result.data) : null
}

// ── Auto-fade hook ─────────────────────────────────────

const FADE_DELAY = 30000
const FADE_DURATION = 15000

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

  const onDeleteRef = useRef(() => onDismiss(card.id))
  onDeleteRef.current = () => onDismiss(card.id)

  const { opacity, onHover, onLeave } = useAutoFade(card.phase, onDeleteRef)

  useEffect(() => {
    if (card.phase === "input") {
      // Short delay so the DOM element exists before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [card.phase])

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
          background: "rgba(255, 255, 255, 0.95)",
          borderLeft: `3px solid ${
            card.phase === "complete" ? "#16a34a" :
            card.phase === "thinking" ? "#ca8a04" :
            card.phase === "pending" ? "#aaa" :
            color
          }`,
          boxShadow: card.phase === "thinking"
            ? `0 4px 20px rgba(0,0,0,0.08), 0 0 8px rgba(202, 138, 4, 0.15)`
            : card.phase === "complete"
            ? `0 4px 20px rgba(0,0,0,0.08), 0 0 8px rgba(22, 163, 106, 0.15)`
            : `0 4px 20px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.08)`,
          width: card.phase === "complete" ? (card.toolName === "prep" ? 520 : 480) : 300,
          transition: "width 400ms ease, border-color 400ms ease, box-shadow 400ms ease",
        }}
      >
        <div className="flex items-center justify-between px-4 h-8 cursor-grab">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</span>
            {card.isAuto && (
              <span className="text-[9px] font-medium uppercase px-1 py-0.5 rounded bg-black/5 text-black/40">auto</span>
            )}
          </div>
          <button onClick={() => onDismiss(card.id)} className="text-black/25 hover:text-black/50 text-xs leading-none">x</button>
        </div>

        {card.phase === "input" && (
          <form onSubmit={submit} className="px-4 pb-3">
            <input ref={inputRef} value={card.query}
              onChange={e => onQueryChange(card.id, e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") onDismiss(card.id) }}
              placeholder={INPUT_PLACEHOLDERS[card.toolName]}
              className="w-full px-3 py-2 text-sm text-black/80 bg-black/5 rounded-md border border-black/10 focus:outline-none focus:border-black/20 placeholder-black/30" />
          </form>
        )}

        {(card.phase === "pending" || card.phase === "thinking") && (
          <div className="px-4 pb-3">
            {card.query && <div className="text-sm text-black/50 mb-2">{card.query}</div>}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1 rounded-full bg-black/10 overflow-hidden">
                <div className="h-full rounded-full" style={{
                  background: `linear-gradient(90deg, transparent, ${color}88, transparent)`,
                  animation: `shimmer ${card.phase === "thinking" ? "1s" : "2.5s"} ease-in-out infinite`,
                  width: "100%",
                }} />
              </div>
              <span className="text-[10px] text-black/30">{phaseLabel}</span>
            </div>
          </div>
        )}

        {card.phase === "complete" && (
          <div className="px-4 pb-4 pt-1">
            {parsed?.display ? (
              <PresetRenderer data={parsed} color={color} />
            ) : (
              <div className="text-sm text-black/60 leading-relaxed">
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
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [, forceRender] = useState(0) // trigger re-render when positions change meaningfully
  const queues = useRef<Map<string, string[]>>(new Map())
  const processedResults = useRef<Set<string>>(new Set())
  const physicsRef = useRef<PhysicsEngine | null>(null)
  const dragOverride = useRef<Map<string, { x: number; y: number }>>(new Map())
  const onToolSubmitRef = useRef(onToolSubmit)
  onToolSubmitRef.current = onToolSubmit

  // Initialize physics engine — use ref for positions to avoid 60fps state updates
  useEffect(() => {
    let lastRender = 0
    const engine = new PhysicsEngine(
      window.innerWidth,
      window.innerHeight,
      (newPositions) => {
        let changed = false
        for (const [id, pos] of newPositions) {
          if (!dragOverride.current.has(id)) {
            const old = positionsRef.current.get(id)
            if (!old || Math.abs(old.x - pos.x) > 0.5 || Math.abs(old.y - pos.y) > 0.5) {
              positionsRef.current.set(id, pos)
              changed = true
            }
          }
        }
        // Throttle re-renders to ~30fps max
        if (changed) {
          const now = Date.now()
          if (now - lastRender > 33) {
            lastRender = now
            forceRender(n => n + 1)
          }
        }
      }
    )
    physicsRef.current = engine
    return () => engine.destroy()
  }, [])

  // New prompt → create input card + auto-focus
  useEffect(() => {
    if (!activeToolPrompt) return
    const id = nextId(activeToolPrompt.toolName)
    setCards(prev => new Map(prev).set(id, {
      id, toolName: activeToolPrompt.toolName, needsScreenshot: activeToolPrompt.needsScreenshot,
      phase: "input", query: "", result: null, parsedResult: null,
    }))
    physicsRef.current?.addNode(id, 300, 80)
    // Enable mouse events so the input can receive focus
    window.electronAPI.setIgnoreMouse(false)
    onToolCancel()
  }, [activeToolPrompt]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Results → match to cards and upgrade to complete
  // FIX: queue shift happens OUTSIDE setCards to prevent double-shift if React calls updater twice
  useEffect(() => {
    if (toolResults.length === 0) return

    // Step 1: compute matches outside the updater (no side effects inside setCards)
    const matches = new Map<string, any>() // cardId → result
    for (const result of toolResults) {
      if (result._partial) continue
      const rKey = result.taskId || `${result.toolName}-${result.text?.substring(0, 20)}`
      if (processedResults.current.has(rKey)) continue
      processedResults.current.add(rKey)

      const q = queues.current.get(result.toolName)
      const cardId = q?.shift()
      if (cardId) {
        matches.set(cardId, result)
      }
    }

    if (matches.size === 0) return

    // Step 2: apply matches inside the updater (pure state transformation)
    setCards(prev => {
      const next = new Map(prev)
      let changed = false

      for (const [cardId, result] of matches) {
        if (!next.has(cardId)) continue
        const card = next.get(cardId)!
        const parsed = parseResultJSON(result.text, card.toolName)
        next.set(cardId, { ...card, phase: "complete", result, parsedResult: parsed })
        physicsRef.current?.updateNodeSize(cardId, 480, 300)
        changed = true
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

  // Use ref for onToolSubmit to avoid handleSubmit instability
  const handleSubmit = useCallback((cardId: string, toolName: string, args: Record<string, string>, screenshot?: string) => {
    // Extract isAuto flag if present
    const isAuto = args._isAuto === "true"
    delete args._isAuto

    const q = queues.current.get(toolName) || []
    q.push(cardId)
    queues.current.set(toolName, q)
    setCards(prev => { const n = new Map(prev); const c = n.get(cardId); if (c) n.set(cardId, { ...c, phase: "pending", isAuto }); return n })
    onToolSubmitRef.current(toolName, args, screenshot)
  }, []) // stable — uses ref

  const handleQuery = useCallback((id: string, q: string) => {
    setCards(prev => { const n = new Map(prev); const c = n.get(id); if (c) n.set(id, { ...c, query: q }); return n })
  }, [])

  // FIX: handleDismiss also cleans the card out of queues to prevent poisoning
  const handleDismiss = useCallback((id: string) => {
    setCards(prev => { const n = new Map(prev); n.delete(id); return n })
    positionsRef.current.delete(id)
    physicsRef.current?.removeNode(id)
    dragOverride.current.delete(id)
    // Clean card from any queue to prevent stale entries
    queues.current.forEach((q) => {
      const idx = q.indexOf(id)
      if (idx !== -1) q.splice(idx, 1)
    })
  }, [])

  const handleDrag = useCallback((id: string, x: number, y: number) => {
    dragOverride.current.set(id, { x, y })
    positionsRef.current.set(id, { x, y })
    forceRender(n => n + 1)
  }, [])

  const handleDragEnd = useCallback((_id: string) => {
    // Keep drag override — user's manual position persists
  }, [])

  return (
    <div className="fixed inset-0" style={{ pointerEvents: "none" }}>
      <AnimatePresence>
        {Array.from(cards.values()).map(card => {
          const pos = positionsRef.current.get(card.id) || { x: window.innerWidth - 400, y: 100 }
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
