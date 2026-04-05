import React, { useState, useEffect, useRef, useCallback } from "react"
import { useQuery } from "react-query"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import ModelSelector from "../components/ui/ModelSelector"
import RadialLayout from "../components/ManusTools/RadialLayout"
import { usePassiveListener } from "../components/ManusTools/PassiveListener"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral"
  })

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<{role: "user"|"gemini", text: string}[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string }>({ provider: "gemini", model: "gemini-3-pro-preview" })

  // Manus tool state
  const [activeToolPrompt, setActiveToolPrompt] = useState<{ toolName: string; needsScreenshot: boolean } | null>(null)
  const [runningTools, setRunningTools] = useState<Map<string, string>>(new Map())
  const [toolResults, setToolResults] = useState<any[]>([])

  const barRef = useRef<HTMLDivElement>(null)

  // Mic capture — always-on rolling 30s buffer
  const micChunksRef = useRef<Blob[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const [micStatus, setMicStatus] = useState<string>("starting...")
  const [micChunkCount, setMicChunkCount] = useState(0)
  const [lastTranscript, setLastTranscript] = useState<string>("")

  useEffect(() => {
    let recorder: MediaRecorder | null = null

    const startMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            micChunksRef.current.push(e.data)
            while (micChunksRef.current.length > 120) {
              micChunksRef.current.shift()
            }
            setMicChunkCount(micChunksRef.current.length)
          }
        }

        recorder.start(250)
        setMicStatus("live")
        console.log("[Mic] Recording started — 30s rolling buffer")
      } catch (err) {
        setMicStatus("denied")
        console.warn("[Mic] Could not start microphone:", err)
      }
    }

    startMic()

    return () => {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop()
      }
    }
  }, [])

  const { data: screenshots = [], refetch } = useQuery<Array<{ path: string; preview: string }>, Error>(
    ["screenshots"],
    async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        return existing
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load existing screenshots", "error")
        return []
      }
    },
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      refetchOnWindowFocus: true,
      refetchOnMount: true
    }
  )

  const showToast = (
    title: string,
    description: string,
    variant: ToastVariant
  ) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        refetch()
      } else {
        console.error("Failed to delete screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot file", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
    }
  }

  const handleChatSend = async () => {
    if (!chatInput.trim()) return
    setChatMessages((msgs) => [...msgs, { role: "user", text: chatInput }])
    setChatLoading(true)
    setChatInput("")
    try {
      const response = await window.electronAPI.invoke("gemini-chat", chatInput)
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: response }])
    } catch (err) {
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(err) }])
    } finally {
      setChatLoading(false)
      chatInputRef.current?.focus()
    }
  }

  // Load current model configuration on mount
  useEffect(() => {
    const loadCurrentModel = async () => {
      try {
        const config = await window.electronAPI.getCurrentLlmConfig();
        setCurrentModel({ provider: config.provider, model: config.model });
      } catch (error) {
        console.error('Error loading current model config:', error);
      }
    };
    loadCurrentModel();
  }, []);

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight
        const contentWidth = contentRef.current.scrollWidth
        if (isTooltipVisible) {
          contentHeight += tooltipHeight
        }
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight
        })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    const cleanupFunctions = [
      // Manus tool events
      window.electronAPI.onManusToolPrompt((data) => {
        setActiveToolPrompt(data)
      }),
      window.electronAPI.onManusToolStarted((data) => {
        setRunningTools(prev => new Map(prev).set(data.toolName, "running"))
        setActiveToolPrompt(null)
      }),
      window.electronAPI.onManusToolStatus((data) => {
        setRunningTools(prev => new Map(prev).set(data.toolName, data.status))
      }),
      window.electronAPI.onManusToolResult((data) => {
        setRunningTools(prev => {
          const next = new Map(prev)
          next.delete(data.toolName)
          return next
        })
        setToolResults(prev => [data, ...prev])
      }),
      window.electronAPI.onManusToolPartial((data) => {
        setRunningTools(prev => new Map(prev).set(data.toolName, "thinking"))
      }),
      window.electronAPI.onManusToolError((data) => {
        setRunningTools(prev => {
          const next = new Map(prev)
          next.delete(data.toolName)
          return next
        })
        showToast("Tool Error", `${data.toolName}: ${data.error}`, "error")
      }),

      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => refetch()),
      window.electronAPI.onSolutionError((error: string) => {
        showToast(
          "Processing Failed",
          "There was an error processing your screenshots.",
          "error"
        )
        setView("queue")
        console.error("Processing error:", error)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no screenshots to process.",
          "neutral"
        )
      })
    ]

    return () => {
      resizeObserver.disconnect()
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight])

  // Seamless screenshot-to-LLM flow
  useEffect(() => {
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      await refetch();
      setChatLoading(true);
      try {
        const latest = data?.path || (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.path);
        if (latest) {
          const response = await window.electronAPI.invoke("analyze-image-file", latest);
          setChatMessages((msgs) => [...msgs, { role: "gemini", text: response.text }]);
        }
      } catch (err) {
        setChatMessages((msgs) => [...msgs, { role: "gemini", text: "Error: " + String(err) }]);
      } finally {
        setChatLoading(false);
      }
    });
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [refetch]);

  // Stable callback for tool submission
  const handleToolSubmit = useCallback((toolName: string, args: Record<string, string>, screenshotPath?: string) => {
    const doSubmit = async () => {
      let transcript = ""
      if (micChunksRef.current.length >= 8) {
        try {
          setLastTranscript("transcribing...")
          const blob = new Blob([...micChunksRef.current], { type: "audio/webm" })
          const arrayBuffer = await blob.arrayBuffer()
          transcript = await window.electronAPI.transcribeAudioBuffer(arrayBuffer, "audio/webm")
          if (transcript) {
            setLastTranscript(transcript)
            setTimeout(() => setLastTranscript(""), 5000)
          } else {
            setLastTranscript("(empty)")
            setTimeout(() => setLastTranscript(""), 2000)
          }
        } catch (err) {
          setLastTranscript("error")
          setTimeout(() => setLastTranscript(""), 2000)
          console.warn("[Mic] Transcription failed, proceeding without:", err)
        }
      } else {
        setLastTranscript("(not enough audio)")
        setTimeout(() => setLastTranscript(""), 2000)
      }
      window.electronAPI.runManusTool(toolName, { ...args, _transcript: transcript }, screenshotPath)
    }
    doSubmit()
  }, [])

  // Passive listener — auto-triggers intel cards from transcript entities
  const [autoCardCount, setAutoCardCount] = useState(0)

  const handleAutoTrigger = useCallback((entity: string) => {
    console.log(`[PassiveListener] Auto-triggering intel for: "${entity}"`)
    handleToolSubmit("intel", { query: entity, _isAuto: "true" })
    setAutoCardCount(prev => prev + 1)
    setTimeout(() => setAutoCardCount(prev => Math.max(0, prev - 1)), 45000)
  }, [handleToolSubmit])

  // Live transcript state kept for PassiveListener hook (not rendered)
  const [liveTranscript, setLiveTranscript] = useState<string[]>([])

  const handleTranscript = useCallback((text: string) => {
    setLiveTranscript(prev => {
      const next = [...prev, text]
      while (next.length > 10) next.shift()
      return next
    })
  }, [])

  usePassiveListener({
    micChunksRef,
    onTrigger: handleAutoTrigger,
    onTranscript: handleTranscript,
    autoCardCount,
    enabled: micStatus === "live",
  })

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible)
    setTooltipHeight(height)
  }

  const handleChatToggle = () => {
    setIsChatOpen(!isChatOpen)
  }

  const handleSettingsToggle = () => {
    setIsSettingsOpen(!isSettingsOpen)
  }

  const handleModelChange = (provider: "ollama" | "gemini", model: string) => {
    setCurrentModel({ provider, model })
    const modelName = provider === "ollama" ? model : "Gemini 3 Pro"
    setChatMessages((msgs) => [...msgs, { 
      role: "gemini", 
      text: `🔄 Switched to ${provider === "ollama" ? "🏠" : "☁️"} ${modelName}. Ready for your questions!` 
    }])
  }


  return (
    <div
      ref={barRef}
      className="select-none"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        background: "transparent",
      }}
    >
      {/* DEBUG: state indicator — dark blue with white text */}
      <div
        className="fixed bottom-2 left-2 z-[999] px-3 py-1 rounded-lg font-mono"
        style={{
          pointerEvents: "auto",
          background: "rgba(12, 23, 41, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.07)",
          color: "rgba(255, 255, 255, 0.3)",
          fontSize: "11px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
        }}
        onMouseEnter={() => window.electronAPI.setIgnoreMouse(false)}
        onMouseLeave={() => window.electronAPI.setIgnoreMouse(true)}
      >
        running: {runningTools.size} | results: {toolResults.length} | prompt: {activeToolPrompt ? activeToolPrompt.toolName : "none"} | chat: {isChatOpen ? "open" : "closed"}
      </div>

      {/* Command bar — top-left, glassmorphism */}
      <div
        className="fixed top-3 left-3 z-50 px-2 py-1"
        style={{
          pointerEvents: "auto",
          background: "rgba(12, 23, 41, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.07)",
          borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
        }}
        onMouseEnter={() => window.electronAPI.setIgnoreMouse(false)}
        onMouseLeave={() => window.electronAPI.setIgnoreMouse(true)}
      >
        <Toast
          open={toastOpen}
          onOpenChange={setToastOpen}
          variant={toastMessage.variant}
          duration={3000}
        >
          <ToastTitle>{toastMessage.title}</ToastTitle>
          <ToastDescription>{toastMessage.description}</ToastDescription>
        </Toast>
        <div className="w-fit">
          <QueueCommands
            screenshots={screenshots}
            onTooltipVisibilityChange={handleTooltipVisibilityChange}
            onChatToggle={handleChatToggle}
            onSettingsToggle={handleSettingsToggle}
          />
        </div>
        {/* Settings — glass panel */}
        {isSettingsOpen && (
          <div className="mt-2 max-w-sm glass-panel">
            <ModelSelector onModelChange={handleModelChange} onChatOpen={() => setIsChatOpen(true)} />
          </div>
        )}
        {/* Chat — glass panel */}
        {isChatOpen && (
          <div className="mt-2 max-w-md glass-panel p-4 flex flex-col">
            <div
              className="flex-1 overflow-y-auto mb-3 p-3 rounded-xl max-h-64 min-h-[120px]"
              style={{
                background: "rgba(0, 0, 0, 0.2)",
                border: "1px solid rgba(255, 255, 255, 0.07)",
              }}
            >
              {chatMessages.length === 0 ? (
                <div className="text-base text-center mt-8" style={{ color: "rgba(255, 255, 255, 0.3)" }}>
                  Chat with {currentModel.provider === "ollama" ? "local" : "cloud"} {currentModel.model}
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-1.5 text-sm ${
                        msg.role === "user" ? "ml-12" : "mr-12"
                      }`}
                      style={{
                        background: msg.role === "user"
                          ? "rgba(65, 105, 225, 0.2)"
                          : "rgba(255, 255, 255, 0.05)",
                        color: msg.role === "user"
                          ? "rgba(255, 255, 255, 0.85)"
                          : "rgba(255, 255, 255, 0.7)",
                        border: msg.role === "user"
                          ? "1px solid rgba(65, 105, 225, 0.3)"
                          : "1px solid rgba(255, 255, 255, 0.07)",
                        borderRadius: msg.role === "user"
                          ? "16px 16px 4px 16px"
                          : "16px 16px 16px 4px",
                        wordBreak: "break-word",
                        lineHeight: "1.4",
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="flex justify-start mb-3">
                  <div
                    className="px-3 py-1.5 rounded-xl text-xs mr-12"
                    style={{
                      background: "rgba(255, 255, 255, 0.05)",
                      color: "rgba(255, 255, 255, 0.4)",
                      border: "1px solid rgba(255, 255, 255, 0.07)",
                    }}
                  >
                    <span className="inline-flex items-center">
                      <span className="animate-pulse" style={{ color: "rgba(65, 105, 225, 0.5)" }}>...</span>
                      <span className="ml-2">{currentModel.model} is replying</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            <form
              className="flex gap-2 items-center"
              onSubmit={e => { e.preventDefault(); handleChatSend(); }}
            >
              <input
                ref={chatInputRef}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/10"
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "rgba(255, 255, 255, 0.85)",
                }}
                placeholder="Type your message..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="p-2 rounded-lg flex items-center justify-center disabled:opacity-50"
                style={{
                  background: "rgba(65, 105, 225, 0.2)",
                  border: "1px solid rgba(65, 105, 225, 0.3)",
                }}
                disabled={chatLoading || !chatInput.trim()}
                tabIndex={-1}
                aria-label="Send"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="rgba(255, 255, 255, 0.6)" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Radial Manus Tool Overlay */}
      <RadialLayout
        toolResults={toolResults}
        runningTools={runningTools}
        activeToolPrompt={activeToolPrompt}
        onToolSubmit={handleToolSubmit}
        onToolCancel={() => setActiveToolPrompt(null)}
        onDismissResult={(i) => setToolResults(prev => prev.filter((_, j) => j !== i))}
      />
    </div>
  )
}

export default Queue
