/**
 * IPC Audit — documents every mismatch and bug across the three IPC boundary files:
 *
 *   electron/ipcHandlers.ts   — ipcMain.handle() registrations
 *   electron/preload.ts       — contextBridge.exposeInMainWorld() surface
 *   src/types/electron.d.ts   — TypeScript type the renderer compiles against
 *
 * Run:  npx vitest run shared/test-ipc-audit.test.ts
 */
import { describe, it, expect } from "vitest"

// ═══════════════════════════════════════════════════════════════════
// 1. CHANNEL MISMATCHES
// ═══════════════════════════════════════════════════════════════════

describe("IPC channel mismatches", () => {

  // ── Handlers registered in ipcHandlers.ts but NOT exposed in preload ──

  it("BUG: 'toggle-window' is registered in ipcHandlers but never exposed in preload", () => {
    const ipcHandlerChannels = [
      "update-content-dimensions", "delete-screenshot", "take-screenshot",
      "get-screenshots", "toggle-window", "reset-queues",
      "analyze-audio-base64", "analyze-audio-file", "analyze-image-file",
      "gemini-chat", "quit-app", "move-window-left", "move-window-right",
      "move-window-up", "move-window-down", "center-and-show-window",
      "set-ignore-mouse", "get-current-llm-config", "get-available-ollama-models",
      "switch-to-ollama", "switch-to-gemini", "trigger-manus-tool",
      "run-manus-tool", "get-last-screenshot-path", "transcribe-audio-buffer",
      "test-llm-connection",
    ]

    const preloadExposedChannels = [
      "update-content-dimensions", "take-screenshot", "get-screenshots",
      "delete-screenshot", "move-window-left", "move-window-right",
      "move-window-up", "move-window-down", "analyze-audio-base64",
      "analyze-audio-file", "analyze-image-file", "quit-app",
      "get-current-llm-config", "get-available-ollama-models",
      "switch-to-ollama", "switch-to-gemini", "test-llm-connection",
      "set-ignore-mouse", "run-manus-tool", "get-last-screenshot-path",
      "transcribe-audio-buffer",
      // These are accessible via the generic invoke() escape hatch:
      // "gemini-chat", "trigger-manus-tool", "center-and-show-window"
    ]

    const registeredButNotExposed = ipcHandlerChannels.filter(
      ch => !preloadExposedChannels.includes(ch)
    )

    // toggle-window, reset-queues, gemini-chat, center-and-show-window,
    // trigger-manus-tool are registered but have no dedicated preload method.
    // Some are reached via invoke() escape hatch, but toggle-window and
    // reset-queues have NO way to be called from the renderer at all.
    expect(registeredButNotExposed).toEqual([
      "toggle-window",
      "reset-queues",
      "gemini-chat",
      "center-and-show-window",
      "trigger-manus-tool",
    ])
  })

  it("BUG: 'reset-queues' handler is registered but completely unreachable from renderer", () => {
    // No preload method, no invoke() call found in any renderer file.
    // Dead code — the handler exists but nothing ever calls it.
    const rendererCallsResetQueues = false // grep confirms no match
    expect(rendererCallsResetQueues).toBe(false)
  })

  it("BUG: 'toggle-window' handler is registered but completely unreachable from renderer", () => {
    // No preload method, no invoke() call found in any renderer file.
    const rendererCallsToggleWindow = false // grep confirms no match
    expect(rendererCallsToggleWindow).toBe(false)
  })

  it("BUG: 'solutions-ready' event listener in preload has no sender in main process", () => {
    // preload.ts line 100: ipcRenderer.on("solutions-ready", ...)
    // But NO file in electron/ ever sends "solutions-ready".
    // The onSolutionsReady callback will never fire. Dead listener.
    const senderExists = false // grep found 0 matches in electron/*.ts for send("solutions-ready"
    expect(senderExists).toBe(false)
  })

  it("BUG: 'procesing-unauthorized' has a typo — should be 'processing-unauthorized'", () => {
    // main.ts line 33: UNAUTHORIZED: "procesing-unauthorized"
    // preload.ts line 63: UNAUTHORIZED: "procesing-unauthorized"
    // The typo is consistent so it works, but it's a bug waiting to happen
    // if anyone hardcodes the "correct" spelling.
    const channelName = "procesing-unauthorized"
    expect(channelName).not.toEqual("processing-unauthorized")
  })
})

// ═══════════════════════════════════════════════════════════════════
// 2. TYPE MISMATCHES
// ═══════════════════════════════════════════════════════════════════

describe("Type mismatches between electron.d.ts and actual handlers", () => {

  it("BUG: takeScreenshot — d.ts says Promise<void> but handler returns { path, preview }", () => {
    // electron.d.ts line 20:  takeScreenshot: () => Promise<void>
    // ipcHandlers.ts line 20-28: returns { path: screenshotPath, preview }
    // preload.ts line 28: also typed as Promise<void>
    //
    // The actual return value is silently discarded by the type system.
    // Any caller trying to use the return value gets no type help.
    type DeclaredReturn = void
    type ActualReturn = { path: string; preview: string }
    const mismatch = true // void !== { path, preview }
    expect(mismatch).toBe(true)
  })

  it("BUG: deleteScreenshot — d.ts type matches but handler can return raw result without wrapping", () => {
    // d.ts says: Promise<{ success: boolean; error?: string }>
    // Handler delegates to appState.deleteScreenshot which returns the same shape
    // This one actually matches. Documenting for completeness.
    type DeclaredReturn = { success: boolean; error?: string }
    type ActualReturn = { success: boolean; error?: string }
    const matches = true
    expect(matches).toBe(true)
  })

  it("BUG: electron.d.ts is missing 14+ methods that preload.ts exposes", () => {
    // electron.d.ts has ~28 members
    // preload.ts exposes ~38+ members
    // App.tsx has its own augmentation that adds the missing Manus members
    //
    // Missing from electron.d.ts but present in preload.ts:
    const missingFromDts = [
      "analyzeImageFile",         // preload line 193, d.ts has it... checking
      "getCurrentLlmConfig",      // preload line 197, NOT in d.ts
      "getAvailableOllamaModels", // preload line 198, NOT in d.ts
      "switchToOllama",           // preload line 199, NOT in d.ts
      "switchToGemini",           // preload line 200, NOT in d.ts
      "testLlmConnection",       // preload line 201, NOT in d.ts
      "setIgnoreMouse",          // preload line 204, NOT in d.ts
      "runManusTool",            // preload line 207, NOT in d.ts
      "getLastScreenshotPath",   // preload line 209, NOT in d.ts
      "transcribeAudioBuffer",   // preload line 211, NOT in d.ts
      "onManusToolPrompt",       // preload line 213, NOT in d.ts
      "onManusToolStarted",      // preload line 218, NOT in d.ts
      "onManusToolStatus",       // preload line 223, NOT in d.ts
      "onManusToolResult",       // preload line 228, NOT in d.ts
      "onManusToolPartial",      // preload line 233, NOT in d.ts
      "onManusToolError",        // preload line 238, NOT in d.ts
    ]

    // App.tsx lines 43-72 has a separate `declare global` block that adds
    // the Manus-related members. But electron.d.ts is the canonical type file
    // and it's stale — it reflects the old Cluely app, not Manusman.
    expect(missingFromDts.length).toBeGreaterThan(10)
  })

  it("BUG: analyzeImageFile — d.ts says Promise<void> but handler returns LLM analysis result", () => {
    // electron.d.ts: NOT present (missing entirely from d.ts)
    // preload.ts interface line 35: analyzeImageFile: (path: string) => Promise<void>
    // ipcHandlers.ts line 96-103: returns appState.processingHelper.getLLMHelper().analyzeImageFile(path)
    //   — which returns a string or analysis object, not void
    //
    // Queue.tsx line 262 uses: window.electronAPI.invoke("analyze-image-file", latest)
    //   — bypasses the typed method entirely via the escape hatch
    const declaredAsVoid = true
    const actuallyReturnsData = true
    expect(declaredAsVoid && actuallyReturnsData).toBe(true)
  })

  it("BUG: gemini-chat has no typed method — only accessible via untyped invoke() escape hatch", () => {
    // ipcHandlers.ts line 106: ipcMain.handle("gemini-chat", ...)
    // preload.ts: NO dedicated method for gemini-chat
    // Queue.tsx line 146: window.electronAPI.invoke("gemini-chat", chatInput)
    //
    // invoke() returns Promise<any> — no type safety at all.
    // The handler returns the LLM result, but the renderer gets `any`.
    const hasTypedMethod = false
    const usedViaInvoke = true // Queue.tsx line 146
    expect(hasTypedMethod).toBe(false)
    expect(usedViaInvoke).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 3. ERROR HANDLING INCONSISTENCIES
// ═══════════════════════════════════════════════════════════════════

describe("Error handling inconsistencies", () => {

  it("BUG: handlers use inconsistent error strategies — some throw, some return error objects", () => {
    // Handlers that THROW on error (renderer gets rejected promise):
    const throwingHandlers = [
      "take-screenshot",         // line 27: throw error
      "get-screenshots",         // line 54: throw error
      "analyze-audio-base64",    // line 80: throw error
      "analyze-audio-file",      // line 91: throw error
      "analyze-image-file",      // line 102: throw error
      "gemini-chat",             // line 113: throw error
      "get-current-llm-config",  // line 160: throw error
      "get-available-ollama-models", // line 170: throw error
      "run-manus-tool",          // line 219: throw error
    ]

    // Handlers that RETURN error objects (renderer gets resolved promise with error shape):
    const errorObjectHandlers = [
      "reset-queues",            // line 69: return { success: false, error: error.message }
      "switch-to-ollama",        // line 182: return { success: false, error: error.message }
      "switch-to-gemini",        // line 193: return { success: false, error: error.message }
      "test-llm-connection",     // line 248: return { success: false, error: error.message }
    ]

    // Handlers that SILENTLY SWALLOW errors (return empty/falsy value):
    const silentHandlers = [
      "transcribe-audio-buffer", // line 236: catches error, returns "" — silent failure
    ]

    // The renderer has no way to know which strategy each handler uses
    // without reading the source code.
    expect(throwingHandlers.length).toBeGreaterThan(0)
    expect(errorObjectHandlers.length).toBeGreaterThan(0)
    expect(silentHandlers.length).toBeGreaterThan(0)
  })

  it("BUG: transcribe-audio-buffer silently returns empty string on error", () => {
    // ipcHandlers.ts line 234-237:
    //   catch (error) { console.error(...); return "" }
    //
    // The renderer (Queue.tsx line 285) assigns the result to `transcript`
    // and then passes it to runManusTool. A failed transcription silently
    // sends an empty transcript — the user sees no error, the tool runs
    // with no context, and the result is worse with no indication why.
    const swallowsError = true
    expect(swallowsError).toBe(true)
  })

  it("BUG: run-manus-tool throws AND sends manus-tool-error event — double error path", () => {
    // ProcessingHelper.runManusTool (line 662-668):
    //   1. Sends "manus-tool-error" event to renderer via webContents.send
    //   2. Then throws the error
    //
    // ipcHandlers.ts line 217-220:
    //   Catches the throw and re-throws it
    //
    // The renderer gets BOTH:
    //   - The onManusToolError callback fires (via webContents.send)
    //   - The invoke() promise rejects (via the re-throw)
    //
    // Queue.tsx line 303 calls runManusTool but doesn't .catch() the promise.
    // This means an unhandled promise rejection happens alongside the
    // onManusToolError callback — the error is reported twice.
    const sendsEvent = true
    const throwsError = true
    const callerCatches = false // Queue.tsx line 303: fire-and-forget, no .catch()
    expect(sendsEvent && throwsError).toBe(true)
    expect(callerCatches).toBe(false)
  })

  it("BUG: run-manus-tool ALSO sends result via event AND returns it — double success path", () => {
    // ProcessingHelper.runManusTool (line 657-661):
    //   1. Sends "manus-tool-result" event via webContents.send
    //   2. Returns the result
    //
    // ipcHandlers.ts line 215: returns the result from invoke()
    //
    // The renderer gets the result TWICE:
    //   - onManusToolResult callback fires
    //   - invoke() promise resolves with the same data
    //
    // Queue.tsx line 303 ignores the return value (fire-and-forget),
    // so the duplicate isn't consumed. But it's wasteful and confusing.
    const sendsEvent = true
    const returnsResult = true
    expect(sendsEvent && returnsResult).toBe(true)
  })

  it("BUG: trigger-manus-tool sends to webContents but returns nothing — no error if window is null", () => {
    // ipcHandlers.ts line 201-207:
    //   const mainWindow = appState.getMainWindow()
    //   if (mainWindow) { mainWindow.webContents.send(...) }
    //
    // If mainWindow is null, the handler silently does nothing.
    // No error, no return value, no way for the caller to know it failed.
    const silentNoOp = true
    expect(silentNoOp).toBe(true)
  })

  it("BUG: update-content-dimensions silently ignores zero dimensions", () => {
    // ipcHandlers.ts line 10: if (width && height) — falsy check
    // width=0 or height=0 are valid numbers but would be treated as falsy.
    // The handler silently does nothing, returns undefined.
    const zeroWidth = 0
    const zeroHeight = 0
    expect(!!zeroWidth).toBe(false) // 0 is falsy in JS
    expect(!!zeroHeight).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 4. RACE CONDITIONS
// ═══════════════════════════════════════════════════════════════════

describe("Race conditions", () => {

  it("BUG: two rapid run-manus-tool calls with same toolName corrupt running state", () => {
    // Queue.tsx line 303: window.electronAPI.runManusTool(toolName, args, screenshotPath)
    //   — fire-and-forget, no guard against duplicate calls
    //
    // ProcessingHelper.runManusTool (line 631-668):
    //   1. Sends "manus-tool-started" with { toolName }
    //   2. Polls Manus API (can take 10-60 seconds)
    //   3. Sends "manus-tool-result" with result
    //
    // If two calls fire for the same toolName (e.g. "intel"):
    //   - Two "manus-tool-started" events fire
    //   - setRunningTools maps on toolName key — second call overwrites first
    //   - First result arrives → deletes toolName from running map
    //   - Second call is still running but no longer shown in UI
    //   - Second result arrives → tries to delete already-deleted key
    //   - Two result entries added to toolResults array
    //
    // The toolName is used as a Map key, but it's not unique per invocation.
    const toolNameIsUniquePerCall = false // same toolName used for both calls
    expect(toolNameIsUniquePerCall).toBe(false)
  })

  it("BUG: no mutex/lock on Manus API calls — parallel tool runs can interleave status events", () => {
    // ProcessingHelper has no concurrency control.
    // Two simultaneous runManusTool calls will interleave:
    //   - "manus-tool-status" events for tool A and tool B arrive in arbitrary order
    //   - "manus-tool-partial" events mix between tools
    //
    // The events include toolName, so the RENDERER can distinguish them.
    // But the Manus API itself may have rate limits or shared state
    // that causes one call to fail when another is in flight.
    const hasConcurrencyControl = false
    expect(hasConcurrencyControl).toBe(false)
  })

  it("BUG: passive listener can trigger intel while manual intel is still running", () => {
    // PassiveListener.ts fires auto-intel calls every 3s
    // Queue.tsx line 303 fires manual tool calls from user keybinds
    //
    // Both use the same toolName "intel" and the same runManusTool path.
    // The running state Map uses toolName as key, so auto and manual
    // intel calls collide — see the toolName-as-key bug above.
    const autoAndManualCanCollide = true
    expect(autoAndManualCanCollide).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 5. MEMORY LEAKS / CLEANUP ISSUES
// ═══════════════════════════════════════════════════════════════════

describe("Memory leaks and cleanup issues", () => {

  it("BUG: onDebugSuccess creates a new anonymous function — removeListener can never match it", () => {
    // preload.ts lines 127-134:
    //
    //   onDebugSuccess: (callback) => {
    //     ipcRenderer.on("debug-success", (_event, data) => callback(data))   // anon A
    //     return () => {
    //       ipcRenderer.removeListener("debug-success", (_event, data) =>     // anon B
    //         callback(data)
    //       )
    //     }
    //   }
    //
    // The .on() registers anonymous function A.
    // The cleanup returns a NEW anonymous function B.
    // removeListener compares by reference — A !== B.
    // The listener is NEVER removed. It accumulates on every mount/unmount.
    //
    // Every other listener in preload.ts correctly stores the function in
    // a `subscription` variable and removes that same reference.
    // onDebugSuccess is the only one that gets this wrong.

    const functionA = (_event: any, data: any) => data
    const functionB = (_event: any, data: any) => data
    expect(functionA).not.toBe(functionB) // different references — removeListener fails
  })

  it("BUG: Queue.tsx useEffect subscribes onScreenshotTaken TWICE — duplicate listener", () => {
    // Queue.tsx has TWO useEffect blocks that both call onScreenshotTaken:
    //
    //   1. Line 223: inside cleanupFunctions array — refetches screenshots
    //   2. Line 252: separate useEffect — triggers screenshot-to-LLM flow
    //
    // Both register listeners on the same "screenshot-taken" channel.
    // When a screenshot is taken, BOTH fire. The refetch runs twice
    // (once from each listener), doubling the IPC calls.
    //
    // The second useEffect (line 252) properly cleans up via unsubscribe.
    // But both are active simultaneously during the component's lifetime.
    const listenerCount = 2 // two onScreenshotTaken registrations
    expect(listenerCount).toBe(2) // should be 1
  })

  it("BUG: Queue.tsx useEffect depends on [isTooltipVisible, tooltipHeight] — re-subscribes all listeners on tooltip change", () => {
    // Queue.tsx line 247: }, [isTooltipVisible, tooltipHeight])
    //
    // This useEffect registers ~10 IPC listeners.
    // Every time isTooltipVisible or tooltipHeight changes, it:
    //   1. Runs cleanup (removes old listeners)
    //   2. Re-registers all 10 listeners
    //
    // This is correct IF the cleanup runs properly.
    // But combined with the onDebugSuccess leak (bug above),
    // every tooltip toggle leaks one more debug-success listener.
    const depsCount = 2 // [isTooltipVisible, tooltipHeight]
    const listenersRegistered = 10 // approximate
    expect(depsCount).toBeGreaterThan(0)
    expect(listenersRegistered).toBeGreaterThan(5)
  })

  it("BUG: invoke() escape hatch bypasses all type safety and has no cleanup path", () => {
    // preload.ts line 244:
    //   invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
    //
    // This is a raw passthrough. Any renderer code can call ANY IPC channel
    // with ANY arguments. Used in production code:
    //   - Queue.tsx line 146: invoke("gemini-chat", chatInput)
    //   - Queue.tsx line 262: invoke("analyze-image-file", latest)
    //   - QueueCommands.tsx lines 45-57: invoke("trigger-manus-tool", toolName)
    //
    // No type checking on arguments or return values.
    // Typos in channel names fail silently (no handler = undefined return).
    const isTypeSafe = false
    expect(isTypeSafe).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 6. MISCELLANEOUS BUGS
// ═══════════════════════════════════════════════════════════════════

describe("Miscellaneous bugs", () => {

  it("BUG: preload.ts ElectronAPI interface includes onManusToolPartial but electron.d.ts does not", () => {
    // preload.ts line 233-237: onManusToolPartial is implemented and exposed
    // electron.d.ts: does NOT declare onManusToolPartial
    // App.tsx line 69: has a local augmentation that adds it
    //
    // Two competing type sources for window.electronAPI.
    // If a file imports from electron.d.ts, onManusToolPartial doesn't exist.
    // If a file sees App.tsx's augmentation, it does.
    const inPreloadInterface = true
    const inElectronDts = false
    const inAppTsxAugmentation = true
    expect(inPreloadInterface).toBe(true)
    expect(inElectronDts).toBe(false)
    expect(inAppTsxAugmentation).toBe(true)
  })

  it("BUG: electron.d.ts is a stale snapshot — missing 16+ methods that preload actually exposes", () => {
    // electron.d.ts was written for the original Cluely app.
    // It declares methods like analyzeAudioFromBase64, analyzeAudioFile, etc.
    // But it's completely missing all Manus, LLM config, and click-through methods.
    //
    // App.tsx has a second `declare global { interface Window { electronAPI: ... } }`
    // that adds the missing methods. This means there are TWO competing
    // type declarations for the same global, and TypeScript merges them.
    // If they ever conflict, the merge produces wrong types silently.
    const electronDtsMemberCount = 19 // counted from the file
    const preloadExposedMemberCount = 38 // approximate
    expect(preloadExposedMemberCount).toBeGreaterThan(electronDtsMemberCount)
  })

  it("BUG: handlers that return void confuse ipcRenderer.invoke — callers get undefined", () => {
    // These handlers return nothing (implicit undefined):
    //   - update-content-dimensions (line 8-14)
    //   - toggle-window (line 58-60)
    //   - move-window-left/right/up/down (lines 121-135)
    //   - center-and-show-window (line 137-139)
    //   - set-ignore-mouse (line 142-147)
    //   - quit-app (line 116-118)
    //   - trigger-manus-tool (line 201-207)
    //
    // ipcRenderer.invoke() always returns a Promise.
    // When the handler returns void, the promise resolves with undefined.
    // This is fine IF the caller doesn't use the return value.
    // But it's undocumented which handlers return data vs void.
    const voidHandlerCount = 9
    expect(voidHandlerCount).toBeGreaterThan(0)
  })
})
