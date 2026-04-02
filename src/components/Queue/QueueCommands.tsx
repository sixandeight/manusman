import React, { useState, useEffect, useRef } from "react"
import { IoLogOutOutline } from "react-icons/io5"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
}

const KEYBINDS = [
  { keys: "Ctrl+B", label: "Show/Hide overlay" },
  { keys: "Ctrl+H", label: "Take screenshot" },
  { keys: "Ctrl+Enter", label: "Analyze screenshot (Kimi)" },
  { keys: "Ctrl+R", label: "Reset all" },
  { keys: "─", label: "─── Manus Tools ───" },
  { keys: "Ctrl+1", label: "Meeting brief" },
  { keys: "Ctrl+2", label: "Company snapshot" },
  { keys: "Ctrl+3", label: "Deal status" },
  { keys: "Ctrl+4", label: "Number lookup" },
  { keys: "Ctrl+5", label: "Who is this? (screenshot)" },
  { keys: "Ctrl+6", label: "Fact check (screenshot)" },
  { keys: "Ctrl+7", label: "Competitive intel (screenshot)" },
]

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshots: _screenshots,
  onChatToggle,
  onSettingsToggle
}) => {
  const [showKeybinds, setShowKeybinds] = useState(false)
  const keybindRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onTooltipVisibilityChange(showKeybinds, showKeybinds && keybindRef.current ? keybindRef.current.offsetHeight + 10 : 0)
  }, [showKeybinds])

  const btnClass = "px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
  const btnDefault = `${btnClass} bg-white/10 hover:bg-white/20 text-white/80`
  const btnAccent = `${btnClass} bg-blue-500/30 hover:bg-blue-500/50 text-blue-200 border border-blue-400/30`

  return (
    <div className="w-fit">
      {/* Main bar */}
      <div className="flex items-center gap-2 py-2 px-3 rounded-lg" style={{ background: "rgba(20, 20, 30, 0.85)", border: "1px solid rgba(255,255,255,0.15)" }}>

        {/* Manus tools — quick access */}
        <button className={btnAccent} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "meeting_brief")}>
          1 Brief
        </button>
        <button className={btnAccent} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "company_snapshot")}>
          2 Company
        </button>
        <button className={btnAccent} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "deal_status")}>
          3 Deal
        </button>
        <button className={btnAccent} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "number_lookup")}>
          4 Stat
        </button>

        <div className="h-5 w-px bg-white/20" />

        {/* Screenshot tools */}
        <button className={btnDefault} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "who_is_this")}>
          5 Who?
        </button>
        <button className={btnDefault} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "live_fact_check")}>
          6 Fact
        </button>
        <button className={btnDefault} onClick={() => window.electronAPI.invoke("trigger-manus-tool", "competitive_intel")}>
          7 Intel
        </button>

        <div className="h-5 w-px bg-white/20" />

        {/* Utility buttons */}
        <button className={btnDefault} onClick={onChatToggle}>
          Chat
        </button>
        <button className={btnDefault} onClick={onSettingsToggle}>
          Models
        </button>
        <button
          className={`${btnDefault} ${showKeybinds ? "bg-white/20" : ""}`}
          onClick={() => setShowKeybinds(!showKeybinds)}
        >
          Keys
        </button>
        <button
          className="px-2 py-1.5 rounded-md text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Quit"
          onClick={() => window.electronAPI.quitApp()}
        >
          <IoLogOutOutline className="w-4 h-4" />
        </button>
      </div>

      {/* Keybind reference panel */}
      {showKeybinds && (
        <div
          ref={keybindRef}
          className="mt-2 p-3 rounded-lg max-w-md"
          style={{ background: "rgba(20, 20, 30, 0.9)", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          <div className="text-sm font-medium text-white/70 mb-2">Keybinds</div>
          <div className="space-y-1">
            {KEYBINDS.map((kb, i) => (
              kb.keys === "─" ? (
                <div key={i} className="text-xs text-white/30 pt-1">{kb.label}</div>
              ) : (
                <div key={i} className="flex justify-between items-center text-sm">
                  <span className="text-white/60">{kb.label}</span>
                  <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded text-white/50">{kb.keys}</span>
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default QueueCommands
