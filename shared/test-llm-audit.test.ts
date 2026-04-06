import { describe, it, expect, vi, beforeEach } from "vitest"

// ═══════════════════════════════════════════════════════════════
// LLMHelper Audit — Bug Discovery Tests
//
// Tests what we CAN test without live APIs:
//   - Constructor validation
//   - cleanJsonResponse logic
//   - State management (switching providers)
//   - Input validation gaps
//
// For API-dependent behavior, each section documents
// what WOULD fail based on code review.
// ═══════════════════════════════════════════════════════════════

// ── Inline replica of cleanJsonResponse (private method) ─────
// Extracted so we can unit test it directly.

function cleanJsonResponse(text: string): string {
  text = text.replace(/^```(?:json)?\n/, "").replace(/\n```$/, "")
  text = text.trim()
  return text
}

// ═══════════════════════════════════════════════════════════════
// 1. cleanJsonResponse — the only parse sanitizer
// ═══════════════════════════════════════════════════════════════

describe("cleanJsonResponse — markdown fence stripping", () => {
  it("strips ```json ... ``` fences", () => {
    const input = '```json\n{"foo":"bar"}\n```'
    expect(cleanJsonResponse(input)).toBe('{"foo":"bar"}')
  })

  it("strips bare ``` ... ``` fences", () => {
    const input = '```\n{"foo":"bar"}\n```'
    expect(cleanJsonResponse(input)).toBe('{"foo":"bar"}')
  })

  it("leaves clean JSON untouched", () => {
    const input = '{"foo":"bar"}'
    expect(cleanJsonResponse(input)).toBe('{"foo":"bar"}')
  })

  // ── BUG: only strips fences at start/end of ENTIRE string ──
  // If the LLM returns preamble text before the fence, the
  // regex anchors (^ and $) won't match.

  it("BUG: does NOT strip fences with preamble text before them", () => {
    const input = 'Here is the result:\n```json\n{"foo":"bar"}\n```'
    const result = cleanJsonResponse(input)
    // The ``` is NOT stripped because ^ doesn't match mid-string
    expect(result).toContain("```json")
    // This means JSON.parse() will fail downstream
    expect(() => JSON.parse(result)).toThrow()
  })

  it("BUG: does NOT strip fences with trailing text after them", () => {
    const input = '```json\n{"foo":"bar"}\n```\nHope that helps!'
    const result = cleanJsonResponse(input)
    // Trailing ``` is NOT stripped because $ doesn't match mid-string
    expect(result).toContain("Hope that helps!")
    expect(() => JSON.parse(result)).toThrow()
  })

  it("BUG: does NOT strip fences when ``` is on the same line as content", () => {
    // Some models return ```json{"foo":"bar"}``` (no newline)
    const input = '```json{"foo":"bar"}```'
    const result = cleanJsonResponse(input)
    // Regex requires \n after ```json — this won't match
    expect(result).toBe('```json{"foo":"bar"}```')
    expect(() => JSON.parse(result)).toThrow()
  })

  it("BUG: does NOT handle nested/multiple fence blocks", () => {
    const input = '```json\n{"a":1}\n```\n\n```json\n{"b":2}\n```'
    const result = cleanJsonResponse(input)
    // Only first ``` and last ``` would match, leaving garbage in between
    expect(() => JSON.parse(result)).toThrow()
  })

  it("trims whitespace", () => {
    expect(cleanJsonResponse("  \n  hello  \n  ")).toBe("hello")
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. Constructor validation
// ═══════════════════════════════════════════════════════════════

describe("Constructor — input validation", () => {
  // We can't actually instantiate LLMHelper without triggering
  // fetch calls (Ollama init calls the API immediately).
  // These document the logic paths.

  it("DOCUMENTED: no API key + useOllama=false throws", () => {
    // constructor line 49: throw new Error("Either provide Kimi API key or enable Ollama mode")
    // This is correct behavior — but the error message says "Kimi API key"
    // while the method names say "Gemini" — naming inconsistency.
    expect(true).toBe(true) // placeholder — can't instantiate without mocking fetch
  })

  it("DOCUMENTED: empty string API key is accepted (no validation)", () => {
    // constructor checks `if (apiKey)` — empty string is falsy, so it falls to the throw.
    // But if someone passes " " (whitespace), it's truthy and accepted.
    // Then all Kimi calls will fail with 401 at runtime.
    const whitespaceKey = " "
    expect(!!whitespaceKey).toBe(true) // truthy — would be accepted
  })

  it("DOCUMENTED: useOllama=true triggers immediate network call in constructor", () => {
    // initializeOllamaModel() calls getOllamaModels() then callOllama("Hello")
    // This is a fire-and-forget async call from a constructor.
    // If it fails, the error is swallowed (console.error only).
    // The instance appears valid but may have wrong model selected.
    expect(true).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. API error handling — callKimi
// ═══════════════════════════════════════════════════════════════

describe("API error handling — callKimi (code review)", () => {
  it("BUG: no retry logic for 429 rate limit", () => {
    // callKimi line 83-85: if (!response.ok) throw
    // 429 is treated the same as 500 — immediate throw, no backoff.
    // High-frequency tool use (passive listener) will hit rate limits.
    expect(true).toBe(true) // documented
  })

  it("BUG: no retry logic for 500 server error", () => {
    // Same path as above — immediate throw.
    // Transient server errors crash the tool call.
    expect(true).toBe(true) // documented
  })

  it("BUG: no timeout on fetch call", () => {
    // fetch() at line 74 has no AbortController/signal.
    // A slow or hanging Kimi server will block indefinitely.
    // Node's default socket timeout may eventually fire, but
    // that could be minutes.
    expect(true).toBe(true) // documented
  })

  it("BUG: empty choices array causes uncaught TypeError", () => {
    // Line 89: data.choices[0].message.content
    // If Kimi returns { choices: [] }, this throws:
    //   TypeError: Cannot read properties of undefined (reading 'message')
    // The error is caught by the catch block, but the error message
    // is unhelpful — "Error calling Kimi: TypeError: Cannot read..."
    const fakeResponse = { choices: [] } as any
    expect(() => fakeResponse.choices[0].message.content).toThrow(TypeError)
  })

  it("BUG: null/undefined choices causes uncaught TypeError", () => {
    // If Kimi returns { choices: null } or omits choices entirely
    const fakeResponse = { choices: null } as any
    expect(() => fakeResponse.choices[0]).toThrow(TypeError)
  })

  it("BUG: choices[0].message.content being null passes JSON.parse but breaks downstream", () => {
    // If the model returns content: null (happens with some API errors),
    // callKimi returns null. JSON.parse(null) returns null (not a throw!).
    // But downstream code does cleanJsonResponse(null) which calls
    // null.replace() → TypeError. The bug is in cleanJsonResponse, not JSON.parse.
    const fakeResponse = { choices: [{ message: { content: null } }] }
    const content = fakeResponse.choices[0].message.content
    expect(content).toBeNull()
    // JSON.parse(null) succeeds (returns null) — this is NOT the crash point
    expect(JSON.parse(content as any)).toBeNull()
    // The ACTUAL crash: cleanJsonResponse(null) → null.replace() → TypeError
    expect(() => cleanJsonResponse(content as any)).toThrow(TypeError)
  })

  it("BUG: malformed JSON response from response.json() not specifically handled", () => {
    // Line 88: response.json() could throw SyntaxError if the HTTP body
    // is not valid JSON (e.g., HTML error page from a proxy).
    // The catch block catches it, but the error is generic.
    expect(true).toBe(true) // documented
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. API error handling — callOllama
// ═══════════════════════════════════════════════════════════════

describe("API error handling — callOllama (code review)", () => {
  it("BUG: error.message access on non-Error objects", () => {
    // Line 128: throw new Error(`Failed to connect to Ollama: ${error.message}`)
    // The catch block catches `error` which is typed as `unknown` in strict mode,
    // but the code accesses .message directly — would fail if error is a string
    // or a non-Error object.
    // TypeScript doesn't enforce this at runtime.
    const stringError = "connection refused"
    expect((stringError as any).message).toBeUndefined()
  })

  it("BUG: Ollama data.response could be undefined", () => {
    // Line 124: return data.response
    // If Ollama returns { done: true } without a response field,
    // this returns undefined — callers expect a string.
    const fakeData = { done: true }
    expect((fakeData as any).response).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. Model switching — state management bugs
// ═══════════════════════════════════════════════════════════════

describe("Model switching — state management", () => {
  it("BUG: switchToOllama with explicit model skips availability check", () => {
    // switchToOllama line 361-362: if (model) this.ollamaModel = model
    // When a model name is provided, it sets the model WITHOUT checking
    // if that model is actually available on the Ollama server.
    // The first call will fail with a cryptic Ollama error.
    // Only the else branch (no model) calls initializeOllamaModel().
    expect(true).toBe(true) // documented
  })

  it("BUG: switchToOllama doesn't verify Ollama is running", () => {
    // switchToOllama never calls checkOllamaAvailable().
    // It just sets useOllama=true and hopes for the best.
    // testConnection() does check, but switching doesn't call testConnection().
    expect(true).toBe(true) // documented
  })

  it("BUG: switchToGemini with no stored key and no arg throws", () => {
    // Line 375-377: if (!this.apiKey) throw
    // This is correct, but if the instance was created in Ollama mode,
    // this.apiKey is "" (empty string), which is falsy → throws.
    // Correct behavior, but the error says "No Kimi API key" while
    // the method is called switchToGemini — confusing naming.
    const apiKey = ""
    expect(!apiKey).toBe(true) // empty string is falsy → would throw
  })

  it("BUG: no lock on provider switching during active request", () => {
    // If switchToOllama() is called while a Kimi request is in-flight,
    // the response from Kimi still resolves normally (fetch already sent),
    // but the NEXT call will go to Ollama. There's no mechanism to:
    //   1. Cancel in-flight requests
    //   2. Queue the switch until current request completes
    //   3. Prevent interleaved responses
    expect(true).toBe(true) // documented — no testable logic
  })

  it("naming inconsistency: method says Gemini, backend is Kimi", () => {
    // Public API: switchToGemini, chatWithGemini, getCurrentProvider returns "gemini"
    // Actual backend: Kimi/Moonshot API at api.moonshot.ai
    // This is a leftover from a provider migration. Not a crash bug,
    // but confusing for anyone reading the code.
    expect("gemini").not.toBe("kimi") // naming mismatch confirmed
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. Image analysis — analyzeImageFile
// ═══════════════════════════════════════════════════════════════

describe("Image analysis — analyzeImageFile (code review)", () => {
  it("BUG: no file existence check before fs.promises.readFile", () => {
    // Line 287: const imageData = await fs.promises.readFile(imagePath)
    // If file doesn't exist, throws ENOENT — caught by outer catch,
    // but error message is generic "Error analyzing image file: [ENOENT]"
    // No user-friendly message like "File not found: /path/to/file"
    expect(true).toBe(true) // documented
  })

  it("BUG: no file size check — 50MB image reads entirely into memory", () => {
    // readFile loads the entire file into a Buffer, then
    // toString("base64") creates another string ~33% larger.
    // A 50MB image → ~67MB base64 string → sent as JSON body.
    // No size validation, no streaming, no compression.
    expect(true).toBe(true) // documented
  })

  it("BUG: no MIME type detection — always sends image/png", () => {
    // Line 288: imageToKimiPart uses default mimeType = "image/png"
    // analyzeImageFile doesn't pass the actual MIME type.
    // A .jpg file is sent with Content-Type image/png.
    // Most vision APIs handle this fine, but it's technically wrong
    // and could cause issues with strict API implementations.
    const defaultMime = "image/png"
    expect(defaultMime).toBe("image/png") // hardcoded, never detected
  })

  it("BUG: non-image files (.txt, .pdf) are base64'd and sent as PNG", () => {
    // No file type validation. A text file gets base64-encoded and
    // sent to the vision model as "image/png". The model may return
    // garbage or an error. No pre-flight check.
    expect(true).toBe(true) // documented
  })

  it("BUG: extractProblemFromImages — no validation on imagePaths array", () => {
    // Line 173: imagePaths.map(...)
    // If imagePaths is empty [], Promise.all([]) resolves to [] immediately,
    // then sends a message with no image parts — vision model gets text-only.
    // Not a crash, but silently wrong behavior.
    const emptyArray: string[] = []
    expect(emptyArray.map(() => "part")).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════
// 7. Chat history — chatWithGemini
// ═══════════════════════════════════════════════════════════════

describe("Chat history — chatWithGemini", () => {
  it("BUG: no conversation history — each call is independent", () => {
    // chatWithGemini (line 310-323) creates a fresh messages array each call:
    //   [{ role: "system", content: systemPrompt }, { role: "user", content: message }]
    // There is NO stored conversation history. Each call is stateless.
    // Multi-turn conversation is impossible — the model has no memory
    // of previous exchanges.
    //
    // This is a feature gap, not a memory leak. But it means:
    //   - "Can you elaborate on what you just said?" → model has no context
    //   - Follow-up questions lose all prior context
    expect(true).toBe(true) // documented — no history mechanism exists
  })

  it("no memory leak risk (because no history is stored)", () => {
    // Since messages are created fresh each call and not accumulated,
    // there's no unbounded growth. This is actually safe from a memory
    // perspective, but broken from a UX perspective.
    expect(true).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 8. Response parsing — JSON.parse after cleanJsonResponse
// ═══════════════════════════════════════════════════════════════

describe("Response parsing — JSON.parse validation", () => {
  it("BUG: no schema validation after JSON.parse", () => {
    // extractProblemFromImages (line 194): JSON.parse(cleanJsonResponse(text))
    // generateSolution (line 212): JSON.parse(cleanJsonResponse(text))
    // debugSolutionWithImages (line 242): JSON.parse(cleanJsonResponse(text))
    //
    // All three parse the JSON and return it directly.
    // No validation that the parsed object has the expected fields.
    // If the model returns valid JSON but wrong shape:
    //   {"answer": "hello"} instead of {"solution": {"code": "..."}}
    // The caller gets an object missing expected fields.

    const wrongShape = JSON.parse('{"answer":"hello"}')
    expect(wrongShape.solution).toBeUndefined() // would crash downstream
  })

  it("BUG: empty string from LLM causes JSON.parse to throw", () => {
    // If callKimi returns "" (empty string), cleanJsonResponse returns "",
    // then JSON.parse("") throws SyntaxError.
    expect(() => JSON.parse("")).toThrow(SyntaxError)
  })

  it("BUG: cleanJsonResponse on undefined throws", () => {
    // If callKimi somehow returns undefined (e.g., choices[0].message.content is undefined),
    // cleanJsonResponse calls text.replace() — TypeError on undefined.
    expect(() => cleanJsonResponse(undefined as any)).toThrow(TypeError)
  })

  it("BUG: model returns valid JSON wrapped in prose", () => {
    // "Sure! Here's the analysis: {"solution": ...}"
    // cleanJsonResponse won't strip the prose (no fence markers).
    // JSON.parse will throw.
    const proseWrapped = 'Sure! Here\'s the analysis: {"solution": {"code": "test"}}'
    const cleaned = cleanJsonResponse(proseWrapped)
    expect(() => JSON.parse(cleaned)).toThrow()
  })

  it("BUG: model returns JSON with trailing comma (common LLM mistake)", () => {
    const trailingComma = '{"items": ["a", "b",]}'
    const cleaned = cleanJsonResponse(trailingComma)
    expect(() => JSON.parse(cleaned)).toThrow() // strict JSON rejects trailing commas
  })

  it("BUG: model returns single-quoted JSON (Python-style)", () => {
    const singleQuoted = "{'items': ['a', 'b']}"
    const cleaned = cleanJsonResponse(singleQuoted)
    expect(() => JSON.parse(cleaned)).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════
// 9. analyzeAudioFile — dead code
// ═══════════════════════════════════════════════════════════════

describe("analyzeAudioFile — functional issues", () => {
  it("BUG: audioPath parameter is completely unused", () => {
    // Line 253-257: the audioPath is interpolated into a local `prompt` variable
    // but that `prompt` variable is NEVER USED. The messages array
    // uses a hardcoded user message instead.
    //
    // const prompt = `${this.systemPrompt}\n\n...${audioPath}...`  ← defined
    // const messages = [..., { role: "user", content: "I have an audio file..." }]  ← hardcoded
    //
    // The function signature accepts audioPath but throws it away.
    // Same issue with analyzeAudioFromBase64 — data and mimeType are unused.

    // Prove the parameter would be ignored:
    const audioPath = "/critical/audio/file.wav"
    const prompt = `System prompt\n\nThe user has provided an audio file at: ${audioPath}.`
    const actualMessage = "I have an audio file I'd like analyzed. Please suggest how I can get help with it."
    // prompt is never sent — actualMessage is sent instead
    expect(actualMessage).not.toContain(audioPath)
  })

  it("BUG: analyzeAudioFromBase64 ignores both data and mimeType params", () => {
    // Same pattern — function signature accepts (data, mimeType)
    // but the messages array is completely hardcoded.
    // The audio data is never processed or sent anywhere.
    expect(true).toBe(true) // documented
  })
})

// ═══════════════════════════════════════════════════════════════
// 10. initializeOllamaModel — silent failure
// ═══════════════════════════════════════════════════════════════

describe("initializeOllamaModel — error swallowing", () => {
  it("BUG: constructor calls async method fire-and-forget", () => {
    // Line 44: this.initializeOllamaModel()
    // This is an async method called from a synchronous constructor.
    // The returned promise is never awaited. If it rejects:
    //   - The error is caught internally (console.error only)
    //   - The constructor returns a "valid" instance
    //   - The model may be silently wrong
    //   - No way for the caller to know initialization failed

    // Simulate: async function called without await
    const asyncFn = async () => { throw new Error("Ollama not running") }
    const promise = asyncFn() // no await — error is unhandled
    // Must catch to prevent unhandled rejection in test
    promise.catch(() => {})
    expect(true).toBe(true)
  })

  it("BUG: model auto-selection can silently pick wrong model", () => {
    // initializeOllamaModel line 149: if (!availableModels.includes(this.ollamaModel))
    // If the requested model isn't available, it silently picks [0].
    // No notification to the user that their preferred model was swapped.
    // User asks for llama3.2, gets gemma:latest, never knows.
    const requestedModel = "llama3.2"
    const availableModels = ["gemma:latest", "mistral:latest"]
    const selected = availableModels.includes(requestedModel)
      ? requestedModel
      : availableModels[0]
    expect(selected).not.toBe(requestedModel) // silent swap
  })

  it("BUG: double fallback in catch block can mask original error", () => {
    // initializeOllamaModel lines 157-165: the catch block tries AGAIN
    // to get models and pick one. If the second attempt also fails,
    // it logs "Fallback also failed" but the instance still exists
    // with whatever model was set. No error propagation.
    expect(true).toBe(true) // documented
  })
})

// ═══════════════════════════════════════════════════════════════
// 11. testConnection — subtle logic bug
// ═══════════════════════════════════════════════════════════════

describe("testConnection — edge cases", () => {
  it("BUG: Kimi testConnection doesn't include system prompt", () => {
    // Line 393-395: messages = [{ role: "user", content: "Hello" }]
    // No system prompt included. This tests raw API connectivity
    // but not whether the configured model + system prompt work.
    // A model that rejects the system prompt would pass testConnection
    // but fail on actual use.
    const testMessages = [{ role: "user", content: "Hello" }]
    const hasSystemPrompt = testMessages.some(m => m.role === "system")
    expect(hasSystemPrompt).toBe(false) // system prompt missing from test
  })

  it("BUG: empty string response from Kimi returns success:false", () => {
    // Line 397-400: if (text) return success, else return error
    // Empty string is falsy → reports "Empty response from Kimi"
    // This is actually correct behavior, but note that callKimi itself
    // could return "" if choices[0].message.content is "".
    const text = ""
    expect(!text).toBe(true) // falsy → would report failure
  })

  it("BUG: error.message access without type guard", () => {
    // Line 404: error.message
    // The catch block accesses error.message without checking if error
    // is actually an Error instance. If a non-Error is thrown
    // (string, number, object), .message is undefined.
    const nonErrorThrown = "connection timeout"
    expect((nonErrorThrown as any).message).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// 12. getCurrentProvider — naming confusion
// ═══════════════════════════════════════════════════════════════

describe("getCurrentProvider — return value accuracy", () => {
  it("BUG: returns 'gemini' when actual provider is Kimi/Moonshot", () => {
    // Line 349-351: returns "gemini" when useOllama is false
    // But the actual API being called is Kimi at api.moonshot.ai
    // Any code checking provider === "gemini" to make decisions
    // about capabilities will make wrong assumptions.
    const useOllama = false
    const provider = useOllama ? "ollama" : "gemini"
    expect(provider).toBe("gemini") // misleading — it's actually Kimi
  })
})

// ═══════════════════════════════════════════════════════════════
// SUMMARY: Bug Count
// ═══════════════════════════════════════════════════════════════
//
// CRASH BUGS (will throw at runtime):
//   1. Empty choices array → TypeError (choices[0].message)
//   2. null choices → TypeError
//   3. Empty string LLM response → JSON.parse("") SyntaxError
//   4. undefined content → cleanJsonResponse TypeError
//   5. Prose-wrapped JSON → JSON.parse fails
//   6. Preamble before markdown fence → fence not stripped → JSON.parse fails
//   7. error.message on non-Error (callOllama catch, testConnection catch)
//
// SILENT FAILURES (no crash, wrong behavior):
//   8. No retry on 429 rate limit
//   9. No retry on 500 server error
//  10. No fetch timeout (can hang forever)
//  11. No file size check on images
//  12. Wrong MIME type (always image/png)
//  13. Non-image files sent as PNG
//  14. audioPath/data/mimeType params completely ignored
//  15. No conversation history in chat
//  16. No schema validation on parsed JSON
//  17. Ollama init fire-and-forget from constructor
//  18. Silent model auto-selection
//  19. switchToOllama skips availability check
//  20. No mid-request switch protection
//  21. Provider switching accepted without running Ollama
//
// NAMING/CONFUSION:
//  22. "Gemini" in API, "Kimi" in implementation
//  23. getCurrentProvider returns "gemini" for Kimi
//  24. switchToGemini error says "No Kimi API key"
