import { globalShortcut, app } from "electron"
import { AppState } from "./main" // Adjust the import path if necessary

export class ShortcutsHelper {
  private appState: AppState

  constructor(appState: AppState) {
    this.appState = appState
  }

  public registerGlobalShortcuts(): void {
    // Add global shortcut to show/center window
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      console.log("Show/Center window shortcut pressed...")
      this.appState.centerAndShowWindow()
    })

    globalShortcut.register("CommandOrControl+H", async () => {
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow) {
        console.log("Taking screenshot...")
        try {
          const screenshotPath = await this.appState.takeScreenshot()
          const preview = await this.appState.getImagePreview(screenshotPath)
          mainWindow.webContents.send("screenshot-taken", {
            path: screenshotPath,
            preview
          })
        } catch (error) {
          console.error("Error capturing screenshot:", error)
        }
      }
    })

    globalShortcut.register("CommandOrControl+Enter", async () => {
      await this.appState.processingHelper.processScreenshots()
    })

    globalShortcut.register("CommandOrControl+R", () => {
      console.log(
        "Command + R pressed. Canceling requests and resetting queues..."
      )

      // Cancel ongoing API requests
      this.appState.processingHelper.cancelOngoingRequests()

      // Clear both screenshot queues
      this.appState.clearQueues()

      console.log("Cleared queues.")

      // Update the view state to 'queue'
      this.appState.setView("queue")

      // Notify renderer process to switch view to 'queue'
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reset-view")
      }
    })

    // New shortcuts for moving the window
    globalShortcut.register("CommandOrControl+Left", () => {
      console.log("Command/Ctrl + Left pressed. Moving window left.")
      this.appState.moveWindowLeft()
    })

    globalShortcut.register("CommandOrControl+Right", () => {
      console.log("Command/Ctrl + Right pressed. Moving window right.")
      this.appState.moveWindowRight()
    })
    globalShortcut.register("CommandOrControl+Down", () => {
      console.log("Command/Ctrl + down pressed. Moving window down.")
      this.appState.moveWindowDown()
    })
    globalShortcut.register("CommandOrControl+Up", () => {
      console.log("Command/Ctrl + Up pressed. Moving window Up.")
      this.appState.moveWindowUp()
    })

    // ── Manus tool shortcuts ──────────────────────────────────
    // Keybind tools (need text input from user)
    const keybindTools = [
      { key: "CommandOrControl+1", tool: "meeting_brief" },
      { key: "CommandOrControl+2", tool: "company_snapshot" },
      { key: "CommandOrControl+3", tool: "deal_status" },
      { key: "CommandOrControl+4", tool: "number_lookup" },
    ] as const

    for (const { key, tool } of keybindTools) {
      globalShortcut.register(key, () => {
        const mainWindow = this.appState.getMainWindow()
        if (mainWindow) {
          console.log(`[Shortcuts] ${tool} triggered`)
          mainWindow.webContents.send("manus-tool-prompt", { toolName: tool, needsScreenshot: false })
        }
      })
    }

    // Screenshot tools (use last screenshot)
    const screenshotTools = [
      { key: "CommandOrControl+5", tool: "who_is_this" },
      { key: "CommandOrControl+6", tool: "live_fact_check" },
      { key: "CommandOrControl+7", tool: "competitive_intel" },
    ] as const

    for (const { key, tool } of screenshotTools) {
      globalShortcut.register(key, () => {
        const mainWindow = this.appState.getMainWindow()
        if (mainWindow) {
          console.log(`[Shortcuts] ${tool} triggered (screenshot)`)
          mainWindow.webContents.send("manus-tool-prompt", { toolName: tool, needsScreenshot: true })
        }
      })
    }

    globalShortcut.register("CommandOrControl+B", () => {
      this.appState.toggleMainWindow()
      // If window exists and we're showing it, bring it to front
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !this.appState.isVisible()) {
        // Force the window to the front on macOS
        if (process.platform === "darwin") {
          mainWindow.setAlwaysOnTop(true, "normal")
          // Reset alwaysOnTop after a brief delay
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(true, "floating")
            }
          }, 100)
        }
      }
    })

    // Unregister shortcuts when quitting
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
    })
  }
}
