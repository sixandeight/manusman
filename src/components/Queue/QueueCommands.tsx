import React, { useState, useEffect, useRef } from "react"
import { Search, TrendingUp, Presentation, ShieldCheck, MessageCircle, Settings, Keyboard, LogOut } from "lucide-react"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
}

const KEYBINDS = [
  { keys: "Ctrl+B", label: "Show/Hide overlay" },
  { keys: "Ctrl+H", label: "Take screenshot" },
  { keys: "Ctrl+R", label: "Reset all" },
  { keys: "─", label: "─── Tools ───" },
  { keys: "Ctrl+1", label: "Intel (company/person/competitive)" },
  { keys: "Ctrl+2", label: "Deal status" },
  { keys: "Ctrl+3", label: "Meeting prep (screenshot)" },
  { keys: "Ctrl+4", label: "Fact check (screenshot)" },
]

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshots: _screenshots,
  onChatToggle,
  onSettingsToggle
}) => {
  const [showKeybinds, setShowKeybinds] = useState(false)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const keybindRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onTooltipVisibilityChange(showKeybinds, showKeybinds && keybindRef.current ? keybindRef.current.offsetHeight + 10 : 0)
  }, [showKeybinds])

  const flash = (key: string) => {
    setFlashKey(key)
    setTimeout(() => setFlashKey(null), 1500)
  }

  const pillBase = "flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors cursor-pointer"
  const pillStyle = (key: string) => flashKey === key
    ? { background: "#4169E1", color: "#ffffff" }
    : { background: "rgba(15, 29, 50, 0.9)", color: "rgba(255, 255, 255, 0.55)" }

  return (
    <div className="w-fit">
      {/* Main bar */}
      <div
        className="flex items-center gap-2 py-3 px-4"
        style={{ background: "rgba(12, 23, 41, 0.85)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: "12px" }}
      >
        {/* Tools */}
        <button className={pillBase} style={pillStyle("intel")} onClick={() => { flash("intel"); window.electronAPI.invoke("trigger-manus-tool", "intel") }}>
          <Search className="w-4 h-4" />
          <span className="font-mono font-bold">1</span>
          <span>Intel</span>
        </button>
        <button className={pillBase} style={pillStyle("deal")} onClick={() => { flash("deal"); window.electronAPI.invoke("trigger-manus-tool", "deal_status") }}>
          <TrendingUp className="w-4 h-4" />
          <span className="font-mono font-bold">2</span>
          <span>Deal</span>
        </button>

        <div className="w-px h-6" style={{ background: "rgba(255, 255, 255, 0.07)" }} />

        <button className={pillBase} style={pillStyle("prep")} onClick={() => { flash("prep"); window.electronAPI.invoke("trigger-manus-tool", "prep") }}>
          <Presentation className="w-4 h-4" />
          <span className="font-mono font-bold">3</span>
          <span>Prep</span>
        </button>
        <button className={pillBase} style={pillStyle("fact")} onClick={() => { flash("fact"); window.electronAPI.invoke("trigger-manus-tool", "live_fact_check") }}>
          <ShieldCheck className="w-4 h-4" />
          <span className="font-mono font-bold">4</span>
          <span>Fact</span>
        </button>

        <div className="w-px h-6" style={{ background: "rgba(255, 255, 255, 0.07)" }} />

        {/* Utility buttons */}
        <button className={pillBase} style={pillStyle("chat")} onClick={() => { flash("chat"); onChatToggle() }}>
          <MessageCircle className="w-4 h-4" />
          <span>Chat</span>
        </button>
        <button className={pillBase} style={pillStyle("models")} onClick={() => { flash("models"); onSettingsToggle() }}>
          <Settings className="w-4 h-4" />
          <span>Models</span>
        </button>
        <button
          className={`${pillBase} ${showKeybinds ? "" : ""}`}
          style={showKeybinds ? { background: "#4169E1", color: "#ffffff" } : pillStyle("keys")}
          onClick={() => setShowKeybinds(!showKeybinds)}
        >
          <Keyboard className="w-4 h-4" />
          <span>Keys</span>
        </button>
        <button
          className={pillBase}
          style={{ background: "rgba(239, 68, 68, 0.15)", color: "rgba(239, 68, 68, 0.8)" }}
          title="Quit"
          onClick={() => window.electronAPI.quitApp()}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Keybind reference panel */}
      {showKeybinds && (
        <div
          ref={keybindRef}
          className="mt-2 p-3 max-w-md"
          style={{ background: "rgba(12, 23, 41, 0.85)", border: "1px solid rgba(255, 255, 255, 0.07)", borderRadius: "12px" }}
        >
          <div className="text-sm font-medium mb-2" style={{ color: "rgba(255, 255, 255, 0.55)" }}>Keybinds</div>
          <div className="space-y-1">
            {KEYBINDS.map((kb, i) => (
              kb.keys === "─" ? (
                <div key={i} className="text-xs pt-1" style={{ color: "rgba(255, 255, 255, 0.2)" }}>{kb.label}</div>
              ) : (
                <div key={i} className="flex justify-between items-center text-sm">
                  <span style={{ color: "rgba(255, 255, 255, 0.4)" }}>{kb.label}</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ fontFamily: "'JetBrains Mono Variable', monospace", background: "rgba(255, 255, 255, 0.05)", color: "rgba(255, 255, 255, 0.3)" }}
                  >
                    {kb.keys}
                  </span>
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
