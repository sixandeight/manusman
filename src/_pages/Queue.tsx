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
  const [runningTools, setRunningTools] = useState<Map<string, string>>(new Map()) // toolName -> status
  const [toolResults, setToolResults] = useState<any[]>([])

  const barRef = useRef<HTMLDivElement>(null)

  // Mic capture — always-on rolling 30s buffer
  const micChunksRef = useRef<Blob[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

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
            // Keep only last 30s worth of chunks (at 250ms intervals = 120 chunks)
            while (micChunksRef.current.length > 120) {
              micChunksRef.current.shift()
            }
          }
        }

        recorder.start(250) // chunk every 250ms
        console.log("[Mic] Recording started — 30s rolling buffer")
      } catch (err) {
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
        // Partials only update running status — don't create result entries
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
    // Listen for screenshot taken event
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      // Refetch screenshots to update the queue
      await refetch();
      // Show loading in chat
      setChatLoading(true);
      try {
        // Get the latest screenshot path
        const latest = data?.path || (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.path);
        if (latest) {
          // Call the LLM to process the screenshot
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

  // Stable callback for tool submission — avoids recreating on every render
  const handleToolSubmit = useCallback((toolName: string, args: Record<string, string>, screenshotPath?: string) => {
    const doSubmit = async () => {
      let transcript = ""
      if (micChunksRef.current.length >= 8) {
        try {
          const blob = new Blob([...micChunksRef.current], { type: "audio/webm" })
          const arrayBuffer = await blob.arrayBuffer()
          transcript = await window.electronAPI.transcribeAudioBuffer(arrayBuffer, "audio/webm")
        } catch (err) {
          console.warn("[Mic] Transcription failed, proceeding without:", err)
        }
      }
      window.electronAPI.runManusTool(toolName, { ...args, _transcript: transcript }, screenshotPath)
    }
    doSubmit()
  }, []) // micChunksRef is a ref — stable

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
    // Update chat messages to reflect the model change
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
      {/* DEBUG: state indicator — always visible bottom-left */}
      <div
        className="fixed bottom-2 left-2 z-[999] px-3 py-1 rounded font-mono"
        style={{
          pointerEvents: "auto",
          background: "rgba(0, 255, 0, 0.15)",
          border: "1px solid rgba(0, 255, 0, 0.4)",
          color: "#0f0",
          fontSize: "11px",
        }}
        onMouseEnter={() => window.electronAPI.setIgnoreMouse(false)}
        onMouseLeave={() => window.electronAPI.setIgnoreMouse(true)}
      >
        running: {runningTools.size} | results: {toolResults.length} | prompt: {activeToolPrompt ? activeToolPrompt.toolName : "none"} | chat: {isChatOpen ? "open" : "closed"}
      </div>

      {/* Command bar — top-left, interactive (DEBUG: blue tint) */}
      <div
        className="fixed top-0 left-0 z-50 px-2 py-1"
        style={{
          pointerEvents: "auto",
          background: "rgba(30, 80, 220, 0.15)",
          border: "1px solid rgba(30, 80, 220, 0.35)",
          borderRadius: "0 0 8px 0",
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
        {/* Settings */}
        {isSettingsOpen && (
          <div className="mt-2 max-w-sm">
            <ModelSelector onModelChange={handleModelChange} onChatOpen={() => setIsChatOpen(true)} />
          </div>
        )}
        {/* Chat */}
        {isChatOpen && (
          <div className="mt-2 max-w-md liquid-glass chat-container p-4 flex flex-col">
            <div className="flex-1 overflow-y-auto mb-3 p-3 rounded-lg bg-white/10 backdrop-blur-md max-h-64 min-h-[120px] glass-content border border-white/20 shadow-lg">
              {chatMessages.length === 0 ? (
                <div className="text-base text-gray-600 text-center mt-8">
                  Chat with {currentModel.provider === "ollama" ? "local" : "cloud"} {currentModel.model}
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-1.5 rounded-xl text-sm shadow-md backdrop-blur-sm border ${
                        msg.role === "user"
                          ? "bg-gray-700/80 text-gray-100 ml-12 border-gray-600/40"
                          : "bg-white/85 text-gray-700 mr-12 border-gray-200/50"
                      }`}
                      style={{ wordBreak: "break-word", lineHeight: "1.4" }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="flex justify-start mb-3">
                  <div className="bg-white/85 text-gray-600 px-3 py-1.5 rounded-xl text-xs backdrop-blur-sm border border-gray-200/50 shadow-md mr-12">
                    <span className="inline-flex items-center">
                      <span className="animate-pulse text-gray-400">...</span>
                      <span className="ml-2">{currentModel.model} is replying</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            <form
              className="flex gap-2 items-center glass-content"
              onSubmit={e => { e.preventDefault(); handleChatSend(); }}
            >
              <input
                ref={chatInputRef}
                className="flex-1 rounded-lg px-3 py-2 bg-white/25 backdrop-blur-md text-gray-800 placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400/60 border border-white/40 shadow-lg"
                placeholder="Type your message..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="p-2 rounded-lg bg-gray-600/80 hover:bg-gray-700/80 border border-gray-500/60 flex items-center justify-center backdrop-blur-sm shadow-lg disabled:opacity-50"
                disabled={chatLoading || !chatInput.trim()}
                tabIndex={-1}
                aria-label="Send"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Radial Manus Tool Overlay — center-right, independent of command bar */}
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
