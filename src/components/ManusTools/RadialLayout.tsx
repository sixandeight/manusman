import React, { useEffect, useState, useCallback, useRef } from "react"
import ToolResultCard from "./ToolResultCard"

// ── Position allocation ─────────────────────────────────

interface CardPosition {
  x: number
  y: number
  width: number
  height: number
}

function findOpenPosition(
  existing: Map<string, CardPosition>,
  cardWidth: number,
  cardHeight: number
): { x: number; y: number } {
  const screenW = window.innerWidth
  const screenH = window.innerHeight
  const padding = 16
  const startX = screenW - cardWidth - padding * 3
  const startY = padding * 4

  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 6; row++) {
      const x = startX - col * (cardWidth + padding)
      const y = startY + row * (cardHeight + padding)
      if (x < 0 || y + cardHeight > screenH) continue

      const candidate = { x, y, width: cardWidth, height: cardHeight }
      let overlaps = false
      for (const pos of existing.values()) {
        if (
          candidate.x < pos.x + pos.width + padding &&
          candidate.x + candidate.width + padding > pos.x &&
          candidate.y < pos.y + pos.height + padding &&
          candidate.y + candidate.height + padding > pos.y
        ) {
          overlaps = true
          break
        }
      }
      if (!overlaps) return { x, y }
    }
  }

  return { x: startX - existing.size * 30, y: startY + existing.size * 30 }
}

// ── Card state ──────────────────────────────────────────

type CardPhase = "input" | "pending" | "thinking" | "complete"

interface FloatingCard {
  id: string
  toolName: string
  needsScreenshot: boolean
  phase: CardPhase
  query: string
  result: any | null
  position: { x: number; y: number }
  isDragging: boolean
}

// ── Colors + Labels ─────────────────────────────────────

const TOOL_COLORS: Record<string, string> = {
  who_is_this: "#7c3aed",
  meeting_brief: "#059669",
  live_fact_check: "#d97706",
  company_snapshot: "#2563eb",
  deal_status: "#ea580c",
  competitive_intel: "#dc2626",
  number_lookup: "#0891b2",
}

const TOOL_LABELS: Record<string, string> = {
  who_is_this: "PERSON",
  meeting_brief: "BRIEF",
  live_fact_check: "FACT CHECK",
  company_snapshot: "COMPANY",
  deal_status: "DEAL",
  competitive_intel: "INTEL",
  number_lookup: "STAT",
}

const INPUT_PLACEHOLDERS: Record<string, string> = {
  who_is_this: "Extra context (optional)...",
  meeting_brief: "Person or company name...",
  live_fact_check: "Claim to verify...",
  company_snapshot: "Company name...",
  deal_status: "Client name...",
  competitive_intel: "Competitor name...",
  number_lookup: "What stat to find...",
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

let cardCounter = 0
function nextCardId(toolName: string): string {
  cardCounter++
  return `card-${toolName}-${cardCounter}-${Date.now()}`
}

// ── Draggable wrapper ───────────────────────────────────

const DraggableCard: React.FC<{
  position: { x: number; y: number }
  onDragStart: () => void
  onDrag: (x: number, y: number) => void
  onDragEnd: () => void
  children: React.ReactNode
}> = ({ position, onDragStart, onDrag, onDragEnd, children }) => {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientY - rect.top > 36) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y }
    onDragStart()
    window.electronAPI.setIgnoreMouse(false)

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      onDrag(dragRef.current.origX + ev.clientX - dragRef.current.startX, dragRef.current.origY + ev.clientY - dragRef.current.startY)
    }
    const handleUp = () => {
      dragRef.current = null
      onDragEnd()
      document.removeEventListener("mousemove", handleMove)
      document.removeEventListener("mouseup", handleUp)
    }
    document.addEventListener("mousemove", handleMove)
    document.addEventListener("mouseup", handleUp)
  }, [position, onDragStart, onDrag, onDragEnd])

  return (
    <div
      className="absolute"
      style={{ left: `${position.x}px`, top: `${position.y}px`, pointerEvents: "auto", zIndex: 50 }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => window.electronAPI.setIgnoreMouse(false)}
      onMouseLeave={() => window.electronAPI.setIgnoreMouse(true)}
    >
      {children}
    </div>
  )
}

// ── Unified card — all four phases ──────────────────────

const UnifiedCard: React.FC<{
  card: FloatingCard
  onSubmit: (id: string, toolName: string, args: Record<string, string>, screenshotPath?: string) => void
  onDismiss: (id: string) => void
  onQueryChange: (id: string, query: string) => void
}> = ({ card, onSubmit, onDismiss, onQueryChange }) => {
  const color = TOOL_COLORS[card.toolName] || "#666"
  const label = TOOL_LABELS[card.toolName] || card.toolName
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (card.phase === "input") inputRef.current?.focus()
  }, [card.phase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const args = buildArgs(card.toolName, card.query)
    let screenshotPath: string | undefined
    if (card.needsScreenshot) {
      screenshotPath = await window.electronAPI.getLastScreenshotPath() || undefined
    }
    onSubmit(card.id, card.toolName, args, screenshotPath)
  }

  // Phase label text
  const phaseText = {
    input: "",
    pending: "pending",
    thinking: "thinking",
    complete: "",
  }[card.phase]

  // Shimmer speed
  const shimmerSpeed = card.phase === "thinking" ? "1s" : "2.5s"

  return (
    <div
      className="rounded-lg shadow-lg overflow-hidden"
      style={{
        background: "#ffffff",
        borderLeft: `3px solid ${color}`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)`,
        minWidth: card.phase === "complete" ? "380px" : "280px",
        maxWidth: "420px",
        transition: "min-width 400ms ease",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 cursor-grab">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>{label}</span>
          {card.phase !== "input" && (
            <span
              className={`inline-block w-2 h-2 rounded-full ${card.phase === "thinking" || card.phase === "pending" ? "animate-pulse" : ""}`}
              style={{
                background: card.phase === "complete" ? "#16a34a" : card.phase === "thinking" ? "#d97706" : "#9ca3af",
                boxShadow: `0 0 6px ${card.phase === "complete" ? "#16a34a66" : card.phase === "thinking" ? "#d9770644" : "#9ca3af44"}`,
              }}
            />
          )}
        </div>
        <button onClick={() => onDismiss(card.id)} className="text-gray-300 hover:text-gray-500 text-sm px-1">x</button>
      </div>

      {/* Input phase */}
      {card.phase === "input" && (
        <form onSubmit={handleSubmit} className="px-4 pb-3">
          <input
            ref={inputRef}
            value={card.query}
            onChange={(e) => onQueryChange(card.id, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onDismiss(card.id) }}
            placeholder={INPUT_PLACEHOLDERS[card.toolName] || "Enter query..."}
            className="w-full px-3 py-2 text-sm text-gray-800 bg-gray-50 rounded-md border border-gray-200 focus:outline-none focus:border-gray-400 placeholder-gray-400"
          />
        </form>
      )}

      {/* Pending / Thinking phase */}
      {(card.phase === "pending" || card.phase === "thinking") && (
        <div className="px-4 pb-3">
          {card.query && (
            <div className="text-sm text-gray-500 mb-2">{card.query}</div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, transparent, ${color}66, transparent)`,
                  animation: `shimmer ${shimmerSpeed} ease-in-out infinite`,
                  width: "100%",
                }}
              />
            </div>
            <span className="text-xs text-gray-400 shrink-0">{phaseText}</span>
          </div>
        </div>
      )}

      {/* Complete phase */}
      {card.phase === "complete" && card.result && (
        <>
          <div className="h-px w-full bg-gray-100" />
          <ToolResultCard result={card.result} onDismiss={() => onDismiss(card.id)} _embedded />
        </>
      )}
    </div>
  )
}

// ── Main layout ─────────────────────────────────────────

interface RadialLayoutProps {
  toolResults: any[]
  runningTools: Map<string, string>
  activeToolPrompt: { toolName: string; needsScreenshot: boolean } | null
  onToolSubmit: (toolName: string, args: Record<string, string>, screenshotPath?: string) => void
  onToolCancel: () => void
  onDismissResult: (index: number) => void
}

const RadialLayout: React.FC<RadialLayoutProps> = ({
  toolResults,
  runningTools,
  activeToolPrompt,
  onToolSubmit,
  onToolCancel,
  onDismissResult,
}) => {
  const [cards, setCards] = useState<Map<string, FloatingCard>>(new Map())
  const positionsRef = useRef<Map<string, CardPosition>>(new Map())
  // Map from running toolName+timestamp to card id, for matching results back
  const pendingCardIds = useRef<Map<string, string>>(new Map())

  // New tool prompt → create a card in "input" phase
  useEffect(() => {
    if (!activeToolPrompt) return

    const id = nextCardId(activeToolPrompt.toolName)
    const pos = findOpenPosition(positionsRef.current, 280, 80)
    positionsRef.current.set(id, { ...pos, width: 280, height: 80 })

    setCards(prev => {
      const next = new Map(prev)
      next.set(id, {
        id,
        toolName: activeToolPrompt.toolName,
        needsScreenshot: activeToolPrompt.needsScreenshot,
        phase: "input",
        query: "",
        result: null,
        position: pos,
        isDragging: false,
      })
      return next
    })

    // Clear the prompt so it doesn't re-trigger
    onToolCancel()
  }, [activeToolPrompt])

  // Track running tools status → update matching cards to thinking
  useEffect(() => {
    runningTools.forEach((status, toolName) => {
      const cardId = pendingCardIds.current.get(toolName)
      if (!cardId) return

      setCards(prev => {
        const next = new Map(prev)
        const card = next.get(cardId)
        if (card && card.phase !== "complete") {
          const phase = (status === "thinking" || status === "running") ? "thinking" : card.phase
          next.set(cardId, { ...card, phase })
        }
        return next
      })
    })
  }, [runningTools])

  // Track final results → upgrade card to complete
  useEffect(() => {
    if (toolResults.length === 0) return

    setCards(prev => {
      const next = new Map(prev)

      for (const result of toolResults) {
        if (result._partial) continue

        // Find the card for this result
        const cardId = pendingCardIds.current.get(result.toolName)
        if (cardId && next.has(cardId)) {
          const card = next.get(cardId)!
          positionsRef.current.set(cardId, { ...card.position, width: 380, height: 300 })
          next.set(cardId, { ...card, phase: "complete", result })
          pendingCardIds.current.delete(result.toolName)
        } else {
          // No matching card — create one directly
          const id = nextCardId(result.toolName)
          const pos = findOpenPosition(positionsRef.current, 380, 300)
          positionsRef.current.set(id, { ...pos, width: 380, height: 300 })
          next.set(id, {
            id, toolName: result.toolName, needsScreenshot: false,
            phase: "complete", query: "", result,
            position: pos, isDragging: false,
          })
        }
      }
      return next
    })
  }, [toolResults])

  // Submit handler — transitions card from input → pending, fires API call
  const handleSubmit = useCallback((cardId: string, toolName: string, args: Record<string, string>, screenshotPath?: string) => {
    // Track this card as pending for this toolName
    pendingCardIds.current.set(toolName, cardId)

    setCards(prev => {
      const next = new Map(prev)
      const card = next.get(cardId)
      if (card) {
        next.set(cardId, { ...card, phase: "pending" })
      }
      return next
    })

    // Fire the actual Manus call
    onToolSubmit(toolName, args, screenshotPath)
  }, [onToolSubmit])

  const handleQueryChange = useCallback((id: string, query: string) => {
    setCards(prev => {
      const next = new Map(prev)
      const card = next.get(id)
      if (card) next.set(id, { ...card, query })
      return next
    })
  }, [])

  const handleDrag = useCallback((id: string, x: number, y: number) => {
    setCards(prev => {
      const next = new Map(prev)
      const card = next.get(id)
      if (card) {
        next.set(id, { ...card, position: { x, y } })
        const pos = positionsRef.current.get(id)
        if (pos) positionsRef.current.set(id, { ...pos, x, y })
      }
      return next
    })
  }, [])

  const handleDismiss = useCallback((id: string) => {
    setCards(prev => {
      const next = new Map(prev)
      next.delete(id)
      positionsRef.current.delete(id)
      return next
    })
    const card = cards.get(id)
    if (card?.result) {
      const idx = toolResults.findIndex(r => r.taskId === card.result.taskId)
      if (idx !== -1) onDismissResult(idx)
    }
  }, [cards, toolResults, onDismissResult])

  return (
    <div className="fixed inset-0" style={{ pointerEvents: "none" }}>
      {Array.from(cards.values()).map(card => (
        <DraggableCard
          key={card.id}
          position={card.position}
          onDragStart={() => setCards(prev => { const n = new Map(prev); const c = n.get(card.id); if (c) n.set(card.id, { ...c, isDragging: true }); return n })}
          onDrag={(x, y) => handleDrag(card.id, x, y)}
          onDragEnd={() => setCards(prev => { const n = new Map(prev); const c = n.get(card.id); if (c) n.set(card.id, { ...c, isDragging: false }); return n })}
        >
          <UnifiedCard
            card={card}
            onSubmit={handleSubmit}
            onDismiss={handleDismiss}
            onQueryChange={handleQueryChange}
          />
        </DraggableCard>
      ))}
    </div>
  )
}

export default RadialLayout
