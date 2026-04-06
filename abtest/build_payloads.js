const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname);

const DISPLAY_FORMATS = `stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}
comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}
profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}
verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}
checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}
pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}
chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}`;

const ARCHITECTURE = `SYSTEM: You are the research engine inside Manusman, a transparent desktop overlay used by consultants during live calls. Here is how you fit in:

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
- Output ONLY raw JSON. No markdown, no code fences, no prose, no explanations.`;

const MANUS_SYSTEM = `${ARCHITECTURE}

OUTPUT FORMAT — pick the display type that best represents your findings:

${DISPLAY_FORMATS}

MODE: Answer from your training knowledge ONLY. Do NOT browse the web. Do NOT use any tools. Do NOT search. Answer instantly.`;

function buildPromptA(query, transcript) {
  let p = `${MANUS_SYSTEM}

You are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.

Example:
Input: Stripe
Output: {"display":"chart","chart_type":"bar","title":"Stripe Valuation ($B)","datasets":[{"name":"Valuation","values":[20,36,95,50,91.5],"color":"purple"}],"labels":["2019","2020","2021","2022","2024"],"summary":"$91.5B valuation, $1T+ TPV, profitable since 2024"}

Input: ${query}
Output:`;

  if (transcript) {
    p += `\n\nLIVE CONTEXT (last 30 seconds of user's microphone during a live call):\n"""\n${transcript}\n"""\nUse this transcript to inform your response. Prioritize what the user was just discussing.`;
  } else {
    p += `\n\nNOTE: The user is on a live call. No transcript was captured for this request.`;
  }
  return p;
}

function buildPromptB(query, transcript) {
  let p = `SYSTEM: You are the research engine inside Manusman, a transparent desktop overlay used by consultants during live calls.

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

  if (transcript) {
    p += `\n\nLIVE CONTEXT (last 30 seconds of user's microphone during a live call):\n"""\n${transcript}\n"""\nUse this transcript to inform your response. Prioritize what the user was just discussing.`;
  }
  return p;
}

const TRANSCRIPT_T2 = `...yeah so I think their pricing is actually quite competitive, we should look at what Stripe charges for international transactions specifically...`;

const tests = [
  { id: "t1a", prompt: buildPromptA("Stripe", null) },
  { id: "t1b", prompt: buildPromptB("Stripe", null) },
  { id: "t2a", prompt: buildPromptA("Stripe", TRANSCRIPT_T2) },
  { id: "t2b", prompt: buildPromptB("Stripe", TRANSCRIPT_T2) },
  { id: "t3a", prompt: buildPromptA("Jensen Huang", null) },
  { id: "t3b", prompt: buildPromptB("Jensen Huang", null) },
  { id: "t4a", prompt: buildPromptA("Stripe vs Square", null) },
  { id: "t4b", prompt: buildPromptB("Stripe vs Square", null) },
];

for (const t of tests) {
  const payload = JSON.stringify({
    mode: "agent",
    messages: [{ role: "user", content: t.prompt }]
  });
  fs.writeFileSync(path.join(outDir, `payload_${t.id}.json`), payload);
  console.log(`Written payload_${t.id}.json (${payload.length} bytes)`);
}
