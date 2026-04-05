/**
 * Type Sync Test
 *
 * Verifies that the ElectronAPI type declaration (src/types/electron.d.ts)
 * stays in sync with the actual preload implementation (electron/preload.ts),
 * and that no other files redeclare Window.electronAPI inline.
 */
import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"

const ROOT = path.resolve(__dirname, "..")

/** Extract method names from the contextBridge.exposeInMainWorld block in preload.ts */
function getPreloadMethods(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "electron/preload.ts"), "utf-8")
  // Find the exposeInMainWorld object literal
  const start = src.indexOf('contextBridge.exposeInMainWorld("electronAPI",')
  if (start === -1) throw new Error("Could not find contextBridge.exposeInMainWorld in preload.ts")

  // Extract top-level property names (method: ... patterns)
  const block = src.slice(start)
  const methods: string[] = []
  // Match lines like "  methodName:" or "  methodName (" at the first indentation level
  for (const match of block.matchAll(/^\s{2}(\w+)\s*[:(]/gm)) {
    const name = match[1]
    // Skip non-method keywords
    if (["const", "let", "var", "return", "if", "else", "for"].includes(name)) continue
    methods.push(name)
  }
  return [...new Set(methods)]
}

/** Extract method names from the ElectronAPI interface in electron.d.ts */
function getDeclaredMethods(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "src/types/electron.d.ts"), "utf-8")
  // Only parse inside the ElectronAPI interface block
  const start = src.indexOf("interface ElectronAPI {")
  const end = src.indexOf("\n}", start)
  if (start === -1 || end === -1) throw new Error("Could not find ElectronAPI interface in electron.d.ts")
  const block = src.slice(start, end)
  const methods: string[] = []
  for (const match of block.matchAll(/^\s{2}(\w+)\s*[:(]/gm)) {
    methods.push(match[1])
  }
  return [...new Set(methods)]
}

/** Scan src/ for any file that has its own `electronAPI:` inside a `declare global` */
function findDuplicateDeclarations(): string[] {
  const dupes: string[] = []
  const srcDir = path.join(ROOT, "src")

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "types") {
        walk(full)
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(full, "utf-8")
        if (content.includes("declare global") && content.includes("electronAPI")) {
          dupes.push(path.relative(ROOT, full))
        }
      }
    }
  }
  walk(srcDir)
  return dupes
}

describe("ElectronAPI type sync", () => {
  it("every method in preload.ts is declared in electron.d.ts", () => {
    const preload = getPreloadMethods()
    const declared = getDeclaredMethods()

    const missing = preload.filter(m => !declared.includes(m))
    expect(missing, `Methods in preload.ts but missing from electron.d.ts: ${missing.join(", ")}`).toEqual([])
  })

  it("electron.d.ts has no extra methods not in preload.ts", () => {
    const preload = getPreloadMethods()
    const declared = getDeclaredMethods()

    const extra = declared.filter(m => !preload.includes(m))
    expect(extra, `Methods in electron.d.ts but not in preload.ts: ${extra.join(", ")}`).toEqual([])
  })

  it("no src/ files redeclare Window.electronAPI inline", () => {
    const dupes = findDuplicateDeclarations()
    expect(dupes, `These files have inline electronAPI declarations (should use electron.d.ts): ${dupes.join(", ")}`).toEqual([])
  })
})
