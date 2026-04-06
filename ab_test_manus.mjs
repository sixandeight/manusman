/**
 * Manus API A/B Test — Prompt A (current) vs Prompt B (proposed)
 * Distributes across 3 API keys to parallelize.
 */

const API_KEYS = [
  "sk-Ud2mm1kMwFnQAWXM-1yzABaORHsoUKaqCo9LihflnZq-Ow4Lv60fATyXE0veAzd1Q0fRz0KZrjLboAovnU6LRroZ12Mw",
  "sk-ilpWM6mpvIDi4xnXINHTArJizmnlwfAokJvJL-I8sOhWM1BmFZVszf2xYNYwQWlQvBSvl4DvwvCtsMDyfaXYYisve4nI",
  "sk-ouN-4k66GfWoFOl70hnAfYixYa1t9AJeP6CJ6wSaPsI_pMP7tTPgLBp4yn3RC3k_kfuqCJITZtrhdzHDu5nv-WWQ9ESd",
];

const BASE_URL = "https://api.manus.ai";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;

// ── Display formats (shared) ──────────────────────────────────────────
const DISPLAY_FORMATS = `stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}
comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}
profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}
verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}
checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}
pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}
chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}`;

const DEMO_MODE = true;

const ARCHITECTURE = `SYSTEM: You are the research engine inside Manusman, a transparent desktop overlay used by consultants during live calls. Here is how you fit in:

1. The user is on a live call (video/phone) with a client or colleague.
2. They press a keybind to trigger you. You may also receive a transcript of the last 30 seconds of their microphone.
3. You research the query and return a single JSON object.
4. Your JSON is rendered as a floating card on their screen — they glance at it mid-conversation.
5. The card auto-fades after 30 seconds, so density matters. Every field should earn its place.

WHAT THIS MEANS FOR YOU:
- You have ONE chance to be useful. No follow-ups, no clarifications.
- The user reads your output in 3-5 seconds while talking to someone. Be glanceable.
- Focus on what's ACTIONABLE RIGHT NOW in a live conversation.
- Only answer about what was asked. Do not hallucinate unrelated entities.
- Output ONLY raw JSON. No markdown, no code fences, no prose, no explanations.`;

const MANUS_SYSTEM = `${ARCHITECTURE}

OUTPUT FORMAT — pick the display type that best represents your findings:

${DISPLAY_FORMATS}

MODE: Answer from your training knowledge ONLY. Do NOT browse the web. Do NOT use any tools. Do NOT search. Answer instantly.`;

// ── Few-shot examples (pool) ──────────────────────────────────────────
const EXAMPLES_INTEL = [
  `Input: Stripe\nOutput: {"display":"chart","chart_type":"bar","title":"Stripe Valuation ($B)","datasets":[{"name":"Valuation","values":[20,36,95,50,91.5],"color":"purple"}],"labels":["2019","2020","2021","2022","2024"],"summary":"$91.5B valuation, $1T+ TPV, profitable since 2024"}`,
  `Input: Anthropic\nOutput: {"display":"profile","name":"Anthropic","role":"AI Safety Lab","company":"Anthropic","details":["Founded 2021 by ex-OpenAI","$18B valuation (Series E)","Claude model family","Amazon + Google invested"],"sentiment":"positive","summary":"Leading AI safety company, enterprise focus, growing fast"}`,
  `Input: Jensen Huang\nOutput: {"display":"profile","name":"Jensen Huang","role":"CEO & Co-founder","company":"NVIDIA","details":["Founded NVIDIA 1993","$3.4T market cap","Drives AI chip strategy"],"sentiment":"positive","summary":"Visionary CEO leading the AI infrastructure revolution"}`,
  `Input: Stripe vs Adyen\nOutput: {"display":"comparison","us_name":"Stripe","them_name":"Adyen","metrics":[{"label":"Developer Experience","us_score":9,"them_score":6},{"label":"Enterprise Features","us_score":7,"them_score":9},{"label":"Global Coverage","us_score":8,"them_score":8},{"label":"Pricing Transparency","us_score":8,"them_score":5}],"verdict":"Stripe wins on developer experience, Adyen stronger in enterprise"}`,
  `Input: prep for Tesla call\nOutput: {"display":"checklist","title":"Call Prep: Tesla","subtitle":"EV leader, $800B+ market cap","context":[{"text":"Q4 deliveries beat estimates","priority":"high"},{"text":"Cybertruck production ramping","priority":"medium"},{"text":"FSD v12 rollout expanding","priority":"medium"}],"items":[{"text":"Ask about fleet pricing","checked":false},{"text":"Discuss API integration timeline","checked":false}]}`,
  `Input: OpenAI ARR\nOutput: {"display":"stat_card","value":"$13B","label":"OpenAI Annualized Revenue","sentiment":"positive","trend":[0.2,1.3,3.4,13],"source":"Internal estimates, 2024","context":"Growing 4x YoY, 300M+ weekly ChatGPT users"}`,
  `Input: cloud market share\nOutput: {"display":"chart","chart_type":"donut","title":"Cloud Infrastructure Market Share","datasets":[{"name":"Share","values":[31,24,11,34],"labels":["AWS","Azure","GCP","Others"],"colors":["orange","blue","red","gray"]}],"summary":"AWS leads at 31%, Azure closing gap at 24%"}`,
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Build Prompt A (current production) ───────────────────────────────
function buildPromptA(query, transcript) {
  let prompt = `${MANUS_SYSTEM}\n\nYou are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.\n\nExample:\n${pick(EXAMPLES_INTEL)}\n\nInput: ${query}\nOutput:`;

  if (transcript) {
    prompt += `\n\nLIVE CONTEXT (last 30 seconds of user's microphone during a live call):\n"""\n${transcript}\n"""\nUse this transcript to inform your response. Prioritize what the user was just discussing.`;
  } else {
    prompt += `\n\nNOTE: The user is on a live call. No transcript was captured for this request.`;
  }
  return prompt;
}

// ── Build Prompt B (proposed structured) ──────────────────────────────
function buildPromptB(query, transcript) {
  let prompt = `SYSTEM: You are the research engine inside Manusman, a transparent desktop overlay used by consultants during live calls.

WHO YOU ARE:
A consultant is on a live call. They pressed a keybind because they need information RIGHT NOW. You research the query and return a single JSON card that appears on their screen. They will glance at it for 3-5 seconds while continuing to talk. The card fades after 30 seconds. You get one shot.

WHAT YOU RECEIVE:
You get up to 3 inputs. Use all of them together.
1. QUERY — what the user typed. Could be a company, person, comparison ("X vs Y"), question, or meeting prep.
2. TRANSCRIPT (if available) — last 30 seconds of the user's microphone. Use it to prioritize. Weight transcript higher than query when they conflict.
3. SCREENSHOT (if available) — what's on the user's screen. Use for identification.

HOW TO PRIORITIZE:
- Transcript > Query when they conflict
- Lead with whatever is most useful for the NEXT 60 seconds
- Skip background info — tell them what's NEW and actionable

WHAT YOU RETURN:
A single raw JSON object. No markdown, no code fences, no prose.

stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}
comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}
profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}
verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}
checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}
pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}
chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}

QUALITY RULES:
- Every field must earn its place. No filler.
- Numbers > adjectives. "$91.5B valuation" not "very highly valued"
- Pick the format that makes the data most useful at a glance.
- Only answer about what was asked. No hallucinated entities.

MODE: Answer from training knowledge ONLY. No browsing. No tools. Answer instantly.

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel.

Example:
Input: Anthropic
Output: {"display":"profile","name":"Anthropic","role":"AI Safety Lab","company":"Anthropic","details":["Founded 2021 by ex-OpenAI","$18B valuation (Series E)","Claude model family","Amazon + Google invested"],"sentiment":"positive","summary":"Leading AI safety company, enterprise focus, growing fast"}`;

  if (transcript) {
    prompt += `\n\nTRANSCRIPT: ${transcript}`;
  }

  prompt += `\n\nInput: ${query}\nOutput:`;

  return prompt;
}

// ── API helpers ───────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createTask(apiKey, prompt) {
  const body = { prompt, mode: "agent" };
  const res = await fetch(`${BASE_URL}/v1/tasks`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "API_KEY": apiKey,
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create task failed: ${res.status} — ${text}`);
  }

  const data = await res.json();
  const taskId = data.taskId || data.task_id || data.id;
  if (!taskId) throw new Error(`No taskId in response: ${JSON.stringify(data)}`);
  return taskId;
}

async function getTaskStatus(apiKey, taskId) {
  const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, {
    method: "GET",
    headers: {
      "accept": "application/json",
      "API_KEY": apiKey,
      "Authorization": `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Poll failed: ${res.status} — ${text}`);
  }

  const data = await res.json();
  if (data.code && data.message) {
    throw new Error(`Manus error: ${data.message} (${data.code})`);
  }
  return data;
}

async function continueTask(apiKey, taskId) {
  await fetch(`${BASE_URL}/v1/tasks`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "API_KEY": apiKey,
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      taskId,
      prompt: "Continue. Do not wait for my input. Complete the task with what you have.",
      mode: "speed",
    }),
  });
}

/**
 * Run a single test: create task, poll, capture all partials.
 * Returns a result object with timing, partials, final output.
 */
async function runSingleTest(apiKey, prompt, label) {
  const startTime = Date.now();
  const partials = []; // { time, messageCount, text }
  let firstPartialTime = null;
  let lastSeenMsgCount = 0;

  console.log(`[${label}] Creating task...`);
  const taskId = await createTask(apiKey, prompt);
  console.log(`[${label}] Task created: ${taskId}`);

  await sleep(2000); // initial delay before polling

  let attempts = 0;
  let finalStatus = null;

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;
    try {
      const status = await getTaskStatus(apiKey, taskId);

      // Capture partials
      if (status.output) {
        const asstMsgs = (status.output || []).filter(m => m.role === "assistant");
        if (asstMsgs.length > lastSeenMsgCount) {
          const elapsed = Date.now() - startTime;
          if (!firstPartialTime) firstPartialTime = elapsed;

          for (let i = lastSeenMsgCount; i < asstMsgs.length; i++) {
            const msg = asstMsgs[i];
            const texts = (msg.content || [])
              .filter(b => (b.type === "output_text" || b.type === "text") && b.text)
              .map(b => b.text);
            partials.push({
              time: elapsed,
              index: i,
              status: msg.status || status.status,
              text: texts.join("\n"),
            });
          }
          lastSeenMsgCount = asstMsgs.length;
          console.log(`[${label}] Partial #${lastSeenMsgCount} at ${elapsed}ms`);
        }
      }

      if (status.status === "completed") {
        finalStatus = status;
        break;
      }

      if (status.status === "failed" || status.status === "error") {
        finalStatus = status;
        break;
      }

      if (status.status === "pending") {
        console.log(`[${label}] Pending — auto-continuing...`);
        try { await continueTask(apiKey, taskId); } catch(e) { /* ignore */ }
      }

      await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      console.error(`[${label}] Poll error: ${e.message}`);
      if (attempts >= MAX_POLL_ATTEMPTS) throw e;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  const totalTime = Date.now() - startTime;

  // Extract final text (prefer JSON with display field)
  let finalText = "";
  let jsonText = "";
  if (finalStatus && finalStatus.output) {
    const asstMsgs = finalStatus.output.filter(m => m.role === "assistant" && m.content);
    for (const msg of asstMsgs) {
      for (const block of msg.content) {
        if ((block.type === "output_text" || block.type === "text") && block.text) {
          const cleaned = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed.display) jsonText = cleaned;
          } catch { /* not json */ }
          finalText = block.text;
        }
      }
    }
  }

  const outputText = jsonText || finalText;
  let validJson = false;
  let parsedOutput = null;
  let displayFormat = null;
  try {
    parsedOutput = JSON.parse(outputText.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim());
    validJson = true;
    displayFormat = parsedOutput.display || null;
  } catch { /* not valid json */ }

  return {
    label,
    taskId,
    totalTime,
    firstPartialTime,
    partialCount: partials.length,
    partials,
    finalText: outputText,
    validJson,
    displayFormat,
    parsedOutput,
    status: finalStatus?.status || "unknown",
  };
}

// ── Test definitions ──────────────────────────────────────────────────

const TRANSCRIPT_TEST5 = "...they mentioned something about their Series C and how they're trying to expand into the Japanese market...";

function defineTests() {
  const tests = [];

  // Test 1: Format diversity — "Stripe" x3 each
  for (let i = 0; i < 3; i++) {
    tests.push({ id: `T1_A_${i+1}`, query: "Stripe", prompt: "A", transcript: null });
    tests.push({ id: `T1_B_${i+1}`, query: "Stripe", prompt: "B", transcript: null });
  }

  // Test 2: Person query
  tests.push({ id: "T2_A", query: "Satya Nadella", prompt: "A", transcript: null });
  tests.push({ id: "T2_B", query: "Satya Nadella", prompt: "B", transcript: null });

  // Test 3: Comparison
  tests.push({ id: "T3_A", query: "AWS vs Azure", prompt: "A", transcript: null });
  tests.push({ id: "T3_B", query: "AWS vs Azure", prompt: "B", transcript: null });

  // Test 4: Meeting prep
  tests.push({ id: "T4_A", query: "prep for call with Databricks", prompt: "A", transcript: null });
  tests.push({ id: "T4_B", query: "prep for call with Databricks", prompt: "B", transcript: null });

  // Test 5: Transcript context
  tests.push({ id: "T5_A", query: "Notion", prompt: "A", transcript: TRANSCRIPT_TEST5 });
  tests.push({ id: "T5_B", query: "Notion", prompt: "B", transcript: TRANSCRIPT_TEST5 });

  // Test 6: Vague query
  tests.push({ id: "T6_A", query: "AI", prompt: "A", transcript: null });
  tests.push({ id: "T6_B", query: "AI", prompt: "B", transcript: null });

  return tests;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const tests = defineTests();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`MANUS A/B TEST — ${tests.length} total tasks across 3 API keys`);
  console.log(`${"=".repeat(70)}\n`);

  // Distribute tests across API keys round-robin
  const jobs = tests.map((test, i) => {
    const keyIndex = i % API_KEYS.length;
    const apiKey = API_KEYS[keyIndex];
    const prompt = test.prompt === "A"
      ? buildPromptA(test.query, test.transcript)
      : buildPromptB(test.query, test.transcript);

    return { ...test, apiKey, fullPrompt: prompt, keyIndex };
  });

  // Run in batches of 3 (one per key) to avoid rate limits
  const results = [];
  const batchSize = 3;

  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    console.log(`\n── Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(jobs.length/batchSize)} ──`);
    console.log(`  Running: ${batch.map(j => j.id).join(", ")}`);

    const batchResults = await Promise.all(
      batch.map(job => runSingleTest(job.apiKey, job.fullPrompt, job.id).catch(err => ({
        label: job.id,
        taskId: "ERROR",
        totalTime: 0,
        firstPartialTime: null,
        partialCount: 0,
        partials: [],
        finalText: `ERROR: ${err.message}`,
        validJson: false,
        displayFormat: null,
        parsedOutput: null,
        status: "error",
      })))
    );

    results.push(...batchResults);
  }

  // ── Print results ─────────────────────────────────────────────────
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("FULL RESULTS");
  console.log(`${"=".repeat(70)}\n`);

  for (const r of results) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`TEST: ${r.label}`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  Status:            ${r.status}`);
    console.log(`  Total time:        ${r.totalTime}ms (${(r.totalTime/1000).toFixed(1)}s)`);
    console.log(`  First partial at:  ${r.firstPartialTime ? `${r.firstPartialTime}ms` : "none"}`);
    console.log(`  Partial messages:  ${r.partialCount}`);
    console.log(`  Valid JSON:        ${r.validJson}`);
    console.log(`  Display format:    ${r.displayFormat || "N/A"}`);

    console.log(`\n  PARTIAL CHAIN:`);
    if (r.partials.length === 0) {
      console.log(`    (none)`);
    } else {
      for (const p of r.partials) {
        const preview = p.text.substring(0, 200).replace(/\n/g, "\\n");
        console.log(`    [${p.time}ms] msg#${p.index} (${p.status}): ${preview}${p.text.length > 200 ? "..." : ""}`);
      }
    }

    console.log(`\n  FINAL OUTPUT:`);
    if (r.parsedOutput) {
      console.log(`    ${JSON.stringify(r.parsedOutput, null, 2).split("\n").join("\n    ")}`);
    } else {
      const preview = (r.finalText || "(empty)").substring(0, 500);
      console.log(`    ${preview}`);
    }
  }

  // ── Summary table ─────────────────────────────────────────────────
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("SUMMARY TABLE");
  console.log(`${"=".repeat(70)}`);
  console.log(`${"ID".padEnd(12)} ${"Time(s)".padEnd(10)} ${"1st Part".padEnd(10)} ${"#Msgs".padEnd(8)} ${"JSON?".padEnd(7)} ${"Format".padEnd(14)} Status`);
  console.log(`${"─".repeat(70)}`);
  for (const r of results) {
    console.log(
      `${r.label.padEnd(12)} ` +
      `${(r.totalTime/1000).toFixed(1).padEnd(10)} ` +
      `${(r.firstPartialTime ? (r.firstPartialTime/1000).toFixed(1) : "—").padEnd(10)} ` +
      `${String(r.partialCount).padEnd(8)} ` +
      `${(r.validJson ? "✓" : "✗").padEnd(7)} ` +
      `${(r.displayFormat || "—").padEnd(14)} ` +
      `${r.status}`
    );
  }

  // ── Test-by-test comparison ───────────────────────────────────────
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("TEST-BY-TEST ANALYSIS");
  console.log(`${"=".repeat(70)}`);

  // Test 1: Format diversity
  console.log(`\n── Test 1: Format Diversity ("Stripe" x3) ──`);
  const t1a = results.filter(r => r.label.startsWith("T1_A"));
  const t1b = results.filter(r => r.label.startsWith("T1_B"));
  console.log(`  Prompt A formats: ${t1a.map(r => r.displayFormat || "?").join(", ")}`);
  console.log(`  Prompt B formats: ${t1b.map(r => r.displayFormat || "?").join(", ")}`);
  const t1aUnique = new Set(t1a.map(r => r.displayFormat)).size;
  const t1bUnique = new Set(t1b.map(r => r.displayFormat)).size;
  console.log(`  A unique formats: ${t1aUnique}/3`);
  console.log(`  B unique formats: ${t1bUnique}/3`);
  console.log(`  A avg time: ${(t1a.reduce((s,r)=>s+r.totalTime,0)/t1a.length/1000).toFixed(1)}s`);
  console.log(`  B avg time: ${(t1b.reduce((s,r)=>s+r.totalTime,0)/t1b.length/1000).toFixed(1)}s`);

  // Test 2-6: Pairwise comparison
  for (const testNum of [2,3,4,5,6]) {
    const testNames = {
      2: 'Person Query ("Satya Nadella")',
      3: 'Comparison ("AWS vs Azure")',
      4: 'Meeting Prep ("prep for call with Databricks")',
      5: 'Transcript Context ("Notion" + transcript)',
      6: 'Vague Query ("AI")',
    };
    const a = results.find(r => r.label === `T${testNum}_A`);
    const b = results.find(r => r.label === `T${testNum}_B`);
    console.log(`\n── Test ${testNum}: ${testNames[testNum]} ──`);
    if (a) {
      console.log(`  A: ${a.displayFormat || "?"} | ${(a.totalTime/1000).toFixed(1)}s | ${a.partialCount} msgs | JSON: ${a.validJson}`);
    }
    if (b) {
      console.log(`  B: ${b.displayFormat || "?"} | ${(b.totalTime/1000).toFixed(1)}s | ${b.partialCount} msgs | JSON: ${b.validJson}`);
    }
  }

  // ── Aggregate comparison ──────────────────────────────────────────
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("AGGREGATE COMPARISON");
  console.log(`${"=".repeat(70)}`);

  const allA = results.filter(r => r.label.includes("_A"));
  const allB = results.filter(r => r.label.includes("_B"));

  const avgTime = arr => arr.reduce((s,r) => s+r.totalTime, 0) / arr.length;
  const avgFirstPartial = arr => {
    const valid = arr.filter(r => r.firstPartialTime);
    return valid.length ? valid.reduce((s,r) => s+r.firstPartialTime, 0) / valid.length : null;
  };
  const avgPartials = arr => arr.reduce((s,r) => s+r.partialCount, 0) / arr.length;
  const jsonRate = arr => arr.filter(r => r.validJson).length / arr.length * 100;

  console.log(`\n  Metric                Prompt A        Prompt B`);
  console.log(`  ${"─".repeat(55)}`);
  console.log(`  Avg total time:       ${(avgTime(allA)/1000).toFixed(1)}s${" ".repeat(12)}${(avgTime(allB)/1000).toFixed(1)}s`);
  const fpA = avgFirstPartial(allA);
  const fpB = avgFirstPartial(allB);
  console.log(`  Avg first partial:    ${fpA ? (fpA/1000).toFixed(1)+"s" : "—"}${" ".repeat(12)}${fpB ? (fpB/1000).toFixed(1)+"s" : "—"}`);
  console.log(`  Avg # partials:       ${avgPartials(allA).toFixed(1)}${" ".repeat(14)}${avgPartials(allB).toFixed(1)}`);
  console.log(`  Valid JSON rate:      ${jsonRate(allA).toFixed(0)}%${" ".repeat(14)}${jsonRate(allB).toFixed(0)}%`);

  console.log(`\n  Format diversity (Test 1 only):`);
  console.log(`    A: ${t1aUnique} unique formats out of 3 runs`);
  console.log(`    B: ${t1bUnique} unique formats out of 3 runs`);

  console.log(`\n\nDone. Raw results saved to ab_test_results.json`);

  // Save raw results
  const fs = await import("fs");
  fs.writeFileSync(
    "C:/Users/natha/Desktop/free-cluely/ab_test_results.json",
    JSON.stringify(results, null, 2)
  );
}

main().catch(console.error);
