import React, { useEffect, useState, useCallback } from "react"
import ToolResultCard from "./ToolResultCard"
import ToolSpinner from "./ToolSpinner"
import ToolPrompt from "./ToolPrompt"

interface RadialItem {
  id: string
  result: any
  age: number // ms since arrival
  fadingOut: boolean
}

const SATELLITE_FADE_MS = 30000 // auto-fade satellites after 30s
const FADE_DURATION_MS = 1000

// Satellite positions relative to center — offset angles for orbiting chips
const SATELLITE_POSITIONS = [
  { angle: -60, distance: 280 },
  { angle: -20, distance: 300 },
  { angle: 20, distance: 290 },
  { angle: 60, distance: 280 },
  { angle: 100, distance: 300 },
  { angle: 140, distance: 290 },
]

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
  const [satellites, setSatellites] = useState<RadialItem[]>([])
  const [center, setCenter] = useState<RadialItem | null>(null)

  // When new results come in, push old center to satellites
  useEffect(() => {
    if (toolResults.length === 0) {
      setCenter(null)
      setSatellites([])
      return
    }

    const newest = toolResults[0]
    const newestId = `${newest.toolName}-${newest.taskId}`

    // If center changed, push old center to satellites
    if (center && center.id !== newestId) {
      setSatellites(prev => [
        { ...center, age: Date.now(), fadingOut: false },
        ...prev,
      ].slice(0, SATELLITE_POSITIONS.length))
    }

    setCenter({
      id: newestId,
      result: newest,
      age: Date.now(),
      fadingOut: false,
    })
  }, [toolResults])

  // Auto-fade satellites
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setSatellites(prev => {
        const updated = prev.map(s => {
          if (!s.fadingOut && now - s.age > SATELLITE_FADE_MS) {
            return { ...s, fadingOut: true }
          }
          return s
        })
        // Remove fully faded (fadingOut for > FADE_DURATION_MS)
        return updated.filter(s => {
          if (s.fadingOut && now - s.age > SATELLITE_FADE_MS + FADE_DURATION_MS) {
            return false
          }
          return true
        })
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Mouse enter/leave for click-through
  const handleMouseEnter = useCallback(() => {
    window.electronAPI.setIgnoreMouse(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    window.electronAPI.setIgnoreMouse(true)
  }, [])

  const hasContent = center || satellites.length > 0 || runningTools.size > 0 || activeToolPrompt

  return (
    <div
      className="fixed inset-0"
      style={{ pointerEvents: "none" }}
    >
      {/* Radial cluster — offset center-right */}
      <div
        className="absolute"
        style={{
          top: "50%",
          left: "68%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      >
        {/* Satellites */}
        {satellites.map((sat, i) => {
          const pos = SATELLITE_POSITIONS[i % SATELLITE_POSITIONS.length]
          const rad = (pos.angle * Math.PI) / 180
          const x = Math.cos(rad) * pos.distance
          const y = Math.sin(rad) * pos.distance

          return (
            <div
              key={sat.id}
              className="absolute transition-all duration-500"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                transform: "translate(-50%, -50%)",
                opacity: sat.fadingOut ? 0 : 0.7,
                transition: `opacity ${FADE_DURATION_MS}ms ease, left 500ms ease, top 500ms ease`,
                pointerEvents: "auto",
                maxWidth: "220px",
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <SatelliteChip
                result={sat.result}
                onDismiss={() => {
                  setSatellites(prev => prev.filter(s => s.id !== sat.id))
                }}
              />
            </div>
          )
        })}

        {/* Center card — main result */}
        {center && (
          <div
            className="absolute transition-all duration-300"
            style={{
              left: "0px",
              top: "0px",
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              maxWidth: "380px",
              minWidth: "320px",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <ToolResultCard
              result={center.result}
              onDismiss={() => {
                const idx = toolResults.findIndex(
                  (r: any) => `${r.toolName}-${r.taskId}` === center.id
                )
                if (idx !== -1) onDismissResult(idx)
              }}
            />
          </div>
        )}

        {/* Spinners for running tools — orbit above center */}
        {Array.from(runningTools.entries()).map(([toolName, status], i) => (
          <div
            key={toolName}
            className="absolute"
            style={{
              left: "0px",
              top: `${-140 - i * 60}px`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              minWidth: "280px",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <ToolSpinner toolName={toolName} status={status} />
          </div>
        ))}

        {/* Tool prompt — below center */}
        {activeToolPrompt && (
          <div
            className="absolute"
            style={{
              left: "0px",
              top: center ? "120px" : "0px",
              transform: "translate(-50%, 0)",
              pointerEvents: "auto",
              minWidth: "340px",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <ToolPrompt
              toolName={activeToolPrompt.toolName}
              needsScreenshot={activeToolPrompt.needsScreenshot}
              onSubmit={onToolSubmit}
              onCancel={onToolCancel}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// Compact satellite chip — smaller than the main card
const SatelliteChip: React.FC<{ result: any; onDismiss: () => void }> = ({ result, onDismiss }) => {
  const TOOL_COLORS: Record<string, string> = {
    who_is_this: "border-purple-400/50",
    meeting_brief: "border-green-400/50",
    live_fact_check: "border-yellow-400/50",
    company_snapshot: "border-blue-400/50",
    deal_status: "border-orange-400/50",
    competitive_intel: "border-red-400/50",
    number_lookup: "border-cyan-400/50",
  }

  const TOOL_LABELS: Record<string, string> = {
    who_is_this: "Person",
    meeting_brief: "Brief",
    live_fact_check: "Fact Check",
    company_snapshot: "Company",
    deal_status: "Deal",
    competitive_intel: "Intel",
    number_lookup: "Stat",
  }

  const borderColor = TOOL_COLORS[result.toolName] || "border-white/20"
  const label = TOOL_LABELS[result.toolName] || result.toolName

  // Truncate text for chip view
  const truncated = result.text?.substring(0, 120) + (result.text?.length > 120 ? "..." : "")

  return (
    <div className={`p-2 bg-black/75 backdrop-blur-md rounded-lg border ${borderColor} shadow-lg`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">{label}</span>
        <button onClick={onDismiss} className="text-white/20 hover:text-white/50 text-xs">x</button>
      </div>
      <p className="text-xs text-white/70 leading-snug">{truncated}</p>
    </div>
  )
}

export default RadialLayout
