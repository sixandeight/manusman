const https = require('https');
const fs = require('fs');
const path = require('path');

const MANUS_KEY = "sk-Ud2mm1kMwFnQAWXM-1yzABaORHsoUKaqCo9LihflnZq-Ow4Lv60fATyXE0veAzd1Q0fRz0KZrjLboAovnU6LRroZ12Mw";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpsRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.manus.ai',
      path: urlPath,
      method,
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'API_KEY': MANUS_KEY,
        'Authorization': `Bearer ${MANUS_KEY}`,
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function createTask(prompt) {
  const res = await httpsRequest('POST', '/v1/tasks', { prompt, mode: 'agent' });
  if (res.status !== 200) throw new Error(`Create failed ${res.status}: ${JSON.stringify(res.body)}`);
  const d = res.body;
  const taskId = d.taskId || d.task_id || d.id;
  if (!taskId) throw new Error(`No taskId: ${JSON.stringify(d)}`);
  return taskId;
}

async function pollTask(taskId, maxAttempts = 60, intervalMs = 5000) {
  await sleep(3000);
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    const res = await httpsRequest('GET', `/v1/tasks/${taskId}`);
    if (res.status !== 200) throw new Error(`Poll ${res.status}: ${JSON.stringify(res.body)}`);
    const d = res.body;
    if (d.code && d.message) throw new Error(`API: ${d.message}`);
    process.stdout.write('.');
    if (d.status === 'completed') return d;
    if (d.status === 'failed' || d.status === 'error') throw new Error(`Task ${d.status}: ${d.error}`);
    if (d.status === 'pending') {
      await httpsRequest('POST', '/v1/tasks', { taskId, prompt: 'Continue. Complete the task now.', mode: 'speed' });
    }
  }
  throw new Error('Timed out');
}

function extractText(ts) {
  if (!ts.output) return '';
  const msgs = ts.output.filter(m => m.role === 'assistant' && m.content?.length);
  let jsonText = '', lastText = '';
  for (const msg of msgs) {
    for (const b of msg.content) {
      if ((b.type === 'output_text' || b.type === 'text') && b.text) {
        const cleaned = b.text.trim()
          .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
          .replace(/"(\w+)">([\d.]+)/g, '"$1":$2');
        try { const p = JSON.parse(cleaned); if (p.display) jsonText = b.text; } catch {}
        lastText = b.text;
      }
    }
  }
  return jsonText || lastText;
}

async function runTest(label, prompt) {
  process.stdout.write(`\n[${label}] Creating...`);
  const start = Date.now();
  const taskId = await createTask(prompt);
  process.stdout.write(` ${taskId} | Polling`);
  const ts = await pollTask(taskId);
  const latencyMs = Date.now() - start;
  const text = extractText(ts).trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let parsed = null, validJson = false, hasDisplay = false;
  try { parsed = JSON.parse(text); validJson = true; hasDisplay = !!parsed.display; } catch {}
  console.log(`\n[${label}] ${(latencyMs/1000).toFixed(1)}s | valid=${validJson} | display=${hasDisplay} | format=${parsed?.display||'N/A'}`);
  console.log(`  ${text.substring(0, 400)}`);
  return { label, latencyMs, validJson, hasDisplay, format: parsed?.display||null, parsed, raw: text };
}

const DISPLAY_FORMATS = `stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}
comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}
profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}
verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}
checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}
pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}
chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}`;

const SYS_A = `SYSTEM: You are the research engine inside Manusman, a transparent desktop overlay used by consultants during live calls. Here is how you fit in:

1. The user is on a live call (video/phone) with a client or colleague.
2. They press a keybind to trigger you. You may also receive a transcript of the last 30 seconds of their microphone.
3. You research the query and return a single JSON object.
4. Your JSON is rendered as a floating card on their screen — they glance at it mid-conversation.
5. The card auto-fades after 30 seconds, so density matters. Every field should earn its place.

WHAT THIS MEANS FOR YOU:
- You have ONE chance to be useful. No follow-ups, no clarifications.
- The user reads your output in 3-5 seconds while talking to someone. Be glanceable.
- Focus on what is ACTIONABLE RIGHT NOW in a live conversation.
- Only answer about what was asked. Do not hallucinate unrelated entities.
- Output ONLY raw JSON. No markdown, no code fences, no prose, no explanations.

OUTPUT FORMAT — pick the display type that best represents your findings:

${DISPLAY_FORMATS}

MODE: Answer from your training knowledge ONLY. Do NOT browse the web. Do NOT use any tools. Do NOT search. Answer instantly.`;

function promptA(query) {
  return `${SYS_A}

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.

Example:
Input: Stripe
Output: {"display":"chart","chart_type":"bar","title":"Stripe Valuation ($B)","datasets":[{"name":"Valuation","values":[20,36,95,50,91.5],"color":"purple"}],"labels":["2019","2020","2021","2022","2024"],"summary":"$91.5B valuation, $1T+ TPV, profitable since 2024"}

Input: ${query}
Output:

NOTE: The user is on a live call. No transcript was captured for this request.`;
}

function promptB(query) {
  return `SYSTEM: You are the research engine inside Manusman, a transparent desktop overlay used by consultants during live calls.

WHO YOU ARE:
A consultant is on a live call. They pressed a keybind because they need information RIGHT NOW. You research the query and return a single JSON card that appears on their screen. They will glance at it for 3-5 seconds while continuing to talk. The card fades after 30 seconds. You get one shot.

WHAT YOU RECEIVE:
You get up to 3 inputs. Use all of them together.

1. QUERY — what the user typed. Could be a company name, a person, a comparison ("X vs Y"), a question, or meeting prep.

2. TRANSCRIPT (if available) — last 30 seconds of the user's microphone. This tells you what's being discussed RIGHT NOW.
   - Use it to prioritize. If they're talking about pricing, lead with pricing data.
   - If they mention a name, that's likely who they're with.
   - If the transcript gives more context than the query, weight the transcript higher.
   - If no transcript is provided, just answer the query directly.

3. SCREENSHOT (if available) — what's on the user's screen. Use it to identify people or extract context.

HOW TO PRIORITIZE:
- Transcript > Query when they conflict
- Lead with whatever is most useful for the NEXT 60 seconds of the conversation
- Skip background info the consultant already knows — tell them what's NEW

WHAT YOU RETURN:
A single raw JSON object. No markdown, no code fences, no prose. Pick the format that best fits:

${DISPLAY_FORMATS}

QUALITY RULES:
- Every field must earn its place. No filler.
- Numbers > adjectives. "$91.5B valuation" not "very highly valued"
- Pick the format that makes the data most useful at a glance.
- Only answer about what was asked. No hallucinated entities.

MODE: Answer from your training knowledge ONLY. Do NOT browse the web. Do NOT use tools. Answer instantly.

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company, person, comparison, meeting prep, or stat lookup. Pick the display format that best fits. Make it glanceable in 5 seconds.

Example:
Input: Anthropic
Output: {"display":"profile","name":"Anthropic","role":"AI Safety Lab","company":"Anthropic","details":["Founded 2021 by ex-OpenAI","$18B valuation (Series E)","Claude model family","Amazon + Google invested"],"sentiment":"positive","summary":"Leading AI safety company, enterprise focus, growing fast"}

Input: ${query}
Output:`;
}

async function main() {
  const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'partial_results.json'), 'utf8'));
  const results = [...prev];

  console.log('\n========== TEST 3: Jensen Huang ==========');
  results.push(await runTest('T3-A', promptA('Jensen Huang')));
  results.push(await runTest('T3-B', promptB('Jensen Huang')));

  console.log('\n========== TEST 4: Stripe vs Square ==========');
  results.push(await runTest('T4-A', promptA('Stripe vs Square')));
  results.push(await runTest('T4-B', promptB('Stripe vs Square')));

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));

  console.log('\n\n════════════ FULL SUMMARY ════════════');
  console.log('Label  | Latency  | Valid JSON | Format');
  console.log('-------|----------|-----------|--------------------');
  for (const r of results) {
    console.log(`${r.label.padEnd(6)} | ${(r.latencyMs/1000).toFixed(1).padStart(6)}s | ${String(r.validJson).padEnd(9)} | ${(r.format||'N/A').padEnd(20)}`);
  }

  console.log('\n--- T2 TRANSCRIPT CHECK ---');
  for (const r of results.filter(r => r.label.startsWith('T2'))) {
    const raw = r.raw.toLowerCase();
    const hit = raw.includes('international') || raw.includes('cross-border') || raw.includes('intl') || raw.includes('transaction fee') || raw.includes('1.5%') || raw.includes('0.8%') || raw.includes('currency');
    console.log(`${r.label}: transcript-aware? ${hit ? 'YES' : 'NO'} | format=${r.format}`);
    if (r.parsed) console.log(`  ${JSON.stringify(r.parsed).substring(0, 250)}`);
  }

  console.log('\n--- FULL RESPONSES ---');
  for (const r of results) {
    console.log(`\n[${r.label}] ${r.raw.substring(0, 500)}`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
