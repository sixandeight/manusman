// manus_probe.mjs — verbose Manus task inspector
// Run: node manus_probe.mjs

const API_KEY = "sk-Ud2mm1kMwFnQAWXM-1yzABaORHsoUKaqCo9LihflnZq-Ow4Lv60fATyXE0veAzd1Q0fRz0KZrjLboAovnU6LRroZ12Mw"
const BASE_URL = "https://api.manus.ai"

// ── Shared system prompt (from ProcessingHelper.ts) ───────────────────────────
const DISPLAY_FORMATS = `stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}
comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}
profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}
verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}
checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}
pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}
chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}`

const MANUS_SYSTEM = `SYSTEM: You are the research engine inside Manusman — a transparent overlay on a consultant's screen during live calls.

The user pressed a keybind. You get: a QUERY (what they typed), optionally a TRANSCRIPT (last 30s of their mic), and optionally a SCREENSHOT. If transcript conflicts with query, trust the transcript — it's what's actually being discussed.

You return ONE raw JSON object. No markdown, no fences, no prose. It renders as a card they glance at for 3-5 seconds. It fades after 30s. Every field must earn its place.

Rules: Numbers > adjectives. New info > background. Skip what a senior consultant already knows. No hallucinated entities. Only answer about what was asked.

Pick the best display format:

${DISPLAY_FORMATS}

MODE: Use training knowledge ONLY. No browsing. No tools. No searching. Answer instantly.`

// ── Task definitions ──────────────────────────────────────────────────────────
const TASKS = [
  {
    name: "TEST 1 — Stripe (fast ~7s)",
    prompt: `${MANUS_SYSTEM}

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.

Example:
Input: Stripe
Output: {"display":"chart","chart_type":"bar","title":"Stripe Valuation ($B)","datasets":[{"name":"Valuation","values":[20,36,95,50,91.5],"color":"purple"}],"labels":["2019","2020","2021","2022","2024"],"summary":"$91.5B valuation, $1T+ TPV, profitable since 2024"}

Input: Stripe
Output:`,
  },
  {
    name: "TEST 2 — prep for Databricks call (medium ~17s)",
    prompt: `${MANUS_SYSTEM}

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.

Example:
Input: prep for Tesla call
Output: {"display":"checklist","title":"Call Prep: Tesla","subtitle":"EV leader, $800B+ market cap","context":[{"text":"Q4 deliveries beat estimates","priority":"high"},{"text":"Cybertruck production ramping","priority":"medium"},{"text":"FSD v12 rollout expanding","priority":"medium"}],"items":[{"text":"Ask about fleet pricing","checked":false},{"text":"Discuss API integration timeline","checked":false}]}

Input: prep for Databricks call
Output:`,
  },
  {
    name: "TEST 3 — Notion with transcript (slow ~42s)",
    prompt: `${MANUS_SYSTEM}

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.

Example:
Input: Anthropic
Output: {"display":"profile","name":"Anthropic","role":"AI Safety Lab","company":"Anthropic","details":["Founded 2021 by ex-OpenAI","$18B valuation (Series E)","Claude model family","Amazon + Google invested"],"sentiment":"positive","summary":"Leading AI safety company, enterprise focus, growing fast"}

TRANSCRIPT (last 30s of user's mic): "they mentioned expanding into Japan and their Series C"

Input: Notion
Output:`,
  },
]

// ── API helpers ───────────────────────────────────────────────────────────────
async function createTask(prompt) {
  const res = await fetch(`${BASE_URL}/v1/tasks`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "API_KEY": API_KEY,
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      prompt,
      mode: "agent",
    }),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`createTask HTTP ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function getTaskStatus(taskId) {
  const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, {
    headers: {
      "accept": "application/json",
      "API_KEY": API_KEY,
      "Authorization": `Bearer ${API_KEY}`,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`getTaskStatus HTTP ${res.status}: ${text}`)
  return JSON.parse(text)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function elapsed(startMs) {
  return `+${((Date.now() - startMs) / 1000).toFixed(1)}s`
}

// ── Dump a ManusMessage in detail ─────────────────────────────────────────────
function dumpMessage(i, msg, indent = "  ") {
  const role = msg.role || "?"
  const type = msg.type || "?"
  const status = msg.status ? ` [${msg.status}]` : ""
  const id = msg.id ? ` id=${msg.id}` : ""
  console.log(`${indent}[msg ${i}] role=${role} type=${type}${status}${id}`)

  const extraKeys = Object.keys(msg).filter(k => !["role","type","status","id","content"].includes(k))
  if (extraKeys.length) {
    console.log(`${indent}  extra msg keys: ${extraKeys.map(k => `${k}=${JSON.stringify(msg[k])?.substring(0, 80)}`).join(", ")}`)
  }

  if (Array.isArray(msg.content)) {
    for (let j = 0; j < msg.content.length; j++) {
      const block = msg.content[j]
      const btype = block.type || "?"
      const btext = (block.text || block.fileUrl || JSON.stringify(block) || "").toString()
      const bExtraKeys = Object.keys(block).filter(k => !["type","text","fileUrl","fileName","mimeType"].includes(k))
      console.log(`${indent}  [block ${j}] type=${btype}: ${btext.substring(0, 300)}${btext.length > 300 ? "..." : ""}`)
      if (bExtraKeys.length) {
        console.log(`${indent}    extra block keys: ${bExtraKeys.map(k => `${k}=${JSON.stringify(block[k])?.substring(0, 60)}`).join(", ")}`)
      }
    }
  } else if (msg.content) {
    console.log(`${indent}  content (non-array): ${JSON.stringify(msg.content).substring(0, 200)}`)
  }
}

// ── Run one task verbosely ────────────────────────────────────────────────────
async function runVerbose(task) {
  console.log("\n" + "═".repeat(70))
  console.log(`  ${task.name}`)
  console.log("═".repeat(70))

  // Create
  let createData
  const start = Date.now()
  try {
    createData = await createTask(task.prompt)
  } catch (e) {
    console.error("  FAILED to create task:", e.message)
    return
  }

  const taskId = createData.taskId || createData.task_id || createData.id
  console.log(`[${elapsed(start)}] Created → taskId=${taskId}`)
  console.log(`[${elapsed(start)}] Create response keys: ${Object.keys(createData).join(", ")}`)
  // Print metadata field which might have extra info
  if (createData.metadata) {
    console.log(`[${elapsed(start)}] metadata: ${JSON.stringify(createData.metadata)}`)
  }
  // Print all non-id top-level fields
  for (const [k, v] of Object.entries(createData)) {
    if (k === "taskId" || k === "task_id" || k === "id") continue
    console.log(`[${elapsed(start)}]   ${k}: ${JSON.stringify(v)?.substring(0, 150)}`)
  }

  // Wait 2s before first poll (Manus returns 404 immediately)
  await sleep(2000)

  let prevMsgCount = 0
  let finalData = null
  let pollNum = 0

  while (true) {
    pollNum++
    let data
    try {
      data = await getTaskStatus(taskId)
    } catch (e) {
      console.log(`[${elapsed(start)}] Poll ${pollNum} ERROR: ${e.message}`)
      await sleep(2000)
      continue
    }

    const status = data.status || "?"
    const output = data.output || []
    const newMsgs = output.slice(prevMsgCount)

    console.log(`\n[${elapsed(start)}] Poll ${pollNum} — status=${status} | output.length=${output.length} (+${newMsgs.length} new)`)

    // Print ALL top-level fields except output (printed separately)
    const topKeys = Object.keys(data).filter(k => k !== "output")
    for (const k of topKeys) {
      const v = JSON.stringify(data[k])
      if (k === "status") continue // already shown
      console.log(`  ${k}: ${v?.substring(0, 120)}`)
    }

    // Print new messages in detail
    for (let i = 0; i < newMsgs.length; i++) {
      const absIdx = prevMsgCount + i
      console.log(`  ── NEW MESSAGE (output[${absIdx}]) ──`)
      dumpMessage(absIdx, newMsgs[i])
    }

    prevMsgCount = output.length

    if (status === "completed" || status === "done" || status === "finished" || status === "success") {
      console.log(`\n[${elapsed(start)}] COMPLETED in ${((Date.now() - start)/1000).toFixed(1)}s`)
      finalData = data
      break
    }
    if (status === "failed" || status === "error") {
      console.log(`\n[${elapsed(start)}] FAILED`)
      finalData = data
      break
    }
    if (pollNum >= 60) {
      console.log(`\n[${elapsed(start)}] TIMED OUT`)
      break
    }

    await sleep(2000)
  }

  if (!finalData) return

  // ── Full message chain summary ────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`)
  console.log("FULL OUTPUT MESSAGE CHAIN:")
  const output = finalData.output || []
  for (let i = 0; i < output.length; i++) {
    dumpMessage(i, output[i])
  }

  // ── Raw task top-level ────────────────────────────────────────────────────
  console.log(`\nFINAL TASK TOP-LEVEL FIELDS:`)
  for (const [k, v] of Object.entries(finalData)) {
    if (k === "output") { console.log(`  output: [${output.length} messages]`); continue }
    console.log(`  ${k}: ${JSON.stringify(v)?.substring(0, 200)}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  for (const task of TASKS) {
    await runVerbose(task)
  }
  console.log("\n" + "═".repeat(70))
  console.log("  PROBE COMPLETE")
  console.log("═".repeat(70))
}

main().catch(console.error)
