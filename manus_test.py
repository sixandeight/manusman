import json, time, urllib.request, urllib.error, re, threading

MANUS_KEY = "sk-Ud2mm1kMwFnQAWXM-1yzABaORHsoUKaqCo9LihflnZq-Ow4Lv60fATyXE0veAzd1Q0fRz0KZrjLboAovnU6LRroZ12Mw"
BASE_URL = "https://api.manus.ai/v1"

DEMO_SYSTEM = (
    "You are a consulting intelligence assistant. Answer using your training knowledge ONLY. "
    "Do NOT browse the web. Do NOT use any tools. Do NOT search. Answer immediately from what you already know.\n\n"
    "CRITICAL: Only answer about EXACTLY what was asked. Do NOT make up unrelated companies, products, or events. "
    "Stay focused on the specific entity or question in the input. If asked about Stripe, answer about Stripe -- "
    "not Ford, not random hackathons.\n\n"
    "Output ONLY raw JSON. No markdown, no code fences, no prose.\n\n"
    "Pick the display format that best fits:\n\n"
    'stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}\n'
    'comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}\n'
    'profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}\n'
    'verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}\n'
    'checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}\n'
    'pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}\n'
    'chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}\n\n'
    "Rules: No browsing. No tool use. No searching. Answer instantly. No clarifying questions. No apologies. Stay on topic."
)

PROMPT_A = (
    DEMO_SYSTEM + "\n\n"
    "You are a consulting analyst preparing a live briefing card. Your client is about to enter a meeting and needs "
    "key facts, recent news, and talking points they can glance at during the call. Focus on what is actionable and current.\n\n"
    "Example:\n"
    "Input: Meeting brief for Tesla\n"
    'Output: {"display":"checklist","title":"Meeting Brief: Tesla","subtitle":"EV leader, $800B+ market cap",'
    '"context":[{"text":"Q4 deliveries beat estimates","priority":"high"},{"text":"Cybertruck production ramping","priority":"medium"}],'
    '"items":[{"text":"Ask about fleet pricing","checked":false},{"text":"Discuss API integration timeline","checked":false}]}\n\n'
    "Input: Meeting brief for Anthropic\n"
    "Output:"
)

PROMPT_B = (
    DEMO_SYSTEM + "\n\n"
    "You are a consulting analyst. Your client just mentioned a company during a call and needs a quick snapshot -- "
    "what does this company do, how big are they, what is their latest news, and what numbers matter. Make it dense and visual.\n\n"
    "Example:\n"
    "Input: Research Datadog\n"
    'Output: {"display":"chart","chart_type":"bar","title":"Datadog Revenue ($M)",'
    '"datasets":[{"name":"Revenue","values":[603,1029,1675,2128],"color":"purple"}],'
    '"labels":["2021","2022","2023","2024"],"summary":"$2.1B ARR, 26% YoY growth"}\n\n'
    "Input: Research OpenAI\n"
    "Output:"
)

PROMPT_C = (
    DEMO_SYSTEM + "\n\n"
    "You are a competitive intelligence analyst. Your client is about to discuss a competitor during a live call. "
    "Score them head-to-head across key metrics, identify where we win and lose, and give a one-line verdict. "
    "Make it immediately useful for the conversation.\n\n"
    "Example:\n"
    "Input: Competitive intel on Snowflake\n"
    'Output: {"display":"comparison","us_name":"Us","them_name":"Snowflake",'
    '"metrics":[{"label":"Pricing","us_score":8,"them_score":5},{"label":"Performance","us_score":7,"them_score":8},'
    '{"label":"Ease of Use","us_score":9,"them_score":6},{"label":"Ecosystem","us_score":6,"them_score":9}],'
    '"verdict":"We win on price and UX, they win on ecosystem"}\n\n'
    "Input: Competitive intel on Google DeepMind\n"
    "Output:"
)

TESTS = [
    {"label": "A: meeting_brief(Anthropic)",        "target": "anthropic", "prompt": PROMPT_A},
    {"label": "B: company_snapshot(OpenAI)",        "target": "openai",    "prompt": PROMPT_B},
    {"label": "C: competitive_intel(GoogleDeepMind)","target": "deepmind", "prompt": PROMPT_C},
]


def _safe_json(raw_bytes):
    try:
        return json.loads(raw_bytes)
    except Exception:
        return {"_raw": raw_bytes.decode("utf-8", errors="replace")}


def manus_post(path, body):
    url = BASE_URL + path
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("accept", "application/json")
    req.add_header("content-type", "application/json")
    req.add_header("API_KEY", MANUS_KEY)
    req.add_header("Authorization", "Bearer " + MANUS_KEY)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, _safe_json(e.read())


def manus_get(path):
    url = BASE_URL + path
    req = urllib.request.Request(url, method="GET")
    req.add_header("accept", "application/json")
    req.add_header("API_KEY", MANUS_KEY)
    req.add_header("Authorization", "Bearer " + MANUS_KEY)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, _safe_json(e.read())


def extract_text(data):
    output = data.get("output", [])
    json_texts = []
    plain_texts = []
    for msg in output:
        if msg.get("role") != "assistant":
            continue
        for block in msg.get("content", []):
            if block.get("type") in ("output_text", "text") and block.get("text"):
                raw = block["text"].strip()
                cleaned = re.sub(r"^```(?:json)?\n?", "", raw)
                cleaned = re.sub(r"\n?```$", "", cleaned).strip()
                try:
                    parsed = json.loads(cleaned)
                    if "display" in parsed:
                        json_texts.append(raw)
                        continue
                except Exception:
                    pass
                plain_texts.append(raw)
    if json_texts:
        return json_texts[-1]
    if plain_texts:
        return plain_texts[-1]
    # fallback: check top-level fields
    for key in ("result", "response", "text", "content"):
        val = data.get(key)
        if val and isinstance(val, str):
            return val
    return ""


def run_test(test, results):
    label = test["label"]
    t0 = time.time()

    status, resp = manus_post("/tasks", {"prompt": test["prompt"], "mode": "agent"})
    create_ms = int((time.time() - t0) * 1000)
    print(f"  [{label}] Create -> HTTP {status} ({create_ms}ms)", flush=True)

    if status not in (200, 201):
        results[label] = {"error": f"Create failed HTTP {status}: {json.dumps(resp)[:500]}"}
        print(f"  [{label}] Create error body: {json.dumps(resp)[:500]}", flush=True)
        return

    task_id = resp.get("task_id") or resp.get("id") or resp.get("taskId")
    if not task_id:
        results[label] = {"error": f"No task_id in create response: {json.dumps(resp)[:300]}"}
        return

    print(f"  [{label}] task_id={task_id}", flush=True)
    time.sleep(2)

    attempt = 0
    while True:
        elapsed = time.time() - t0
        if elapsed > 90:
            results[label] = {"task_id": task_id, "error": "Timed out after 90s", "elapsed": elapsed}
            return

        attempt += 1
        poll_status, poll_resp = manus_get(f"/tasks/{task_id}")
        state = poll_resp.get("status") or poll_resp.get("state") or "unknown"
        print(f"  [{label}] poll #{attempt} ({elapsed:.1f}s) HTTP={poll_status} state={state}", flush=True)

        if state in ("completed", "finished", "done", "succeeded", "success"):
            elapsed_final = time.time() - t0
            text = extract_text(poll_resp)
            results[label] = {
                "task_id": task_id,
                "elapsed": elapsed_final,
                "raw_text": text,
                "raw_response": poll_resp,
            }
            return

        if state in ("failed", "error", "cancelled"):
            results[label] = {
                "task_id": task_id,
                "elapsed": time.time() - t0,
                "error": state,
                "raw_response": poll_resp,
            }
            return

        # If waiting for input, nudge
        if state == "pending":
            manus_post("/tasks", {
                "taskId": task_id,
                "prompt": "Continue. Complete the task immediately with your training knowledge.",
                "mode": "agent"
            })

        time.sleep(3)


def report(test, results):
    label = test["label"]
    result = results.get(label, {"error": "no result"})

    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")

    if "error" in result:
        print(f"  ERROR: {result['error']}")
        print(f"  Elapsed: {result.get('elapsed', '?')}")
        return

    elapsed = result["elapsed"]
    raw = result.get("raw_text", "")
    print(f"  Task ID : {result['task_id']}")
    print(f"  Latency : {elapsed:.1f}s")

    # Clean fences
    cleaned = re.sub(r"^```(?:json)?\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned).strip()

    parsed = None
    try:
        parsed = json.loads(cleaned)
    except Exception:
        m = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group())
            except Exception:
                pass

    if parsed and isinstance(parsed, dict):
        display = parsed.get("display", "MISSING")
        keys = list(parsed.keys())
        target = test["target"]
        raw_lower = cleaned.lower()
        relevant = target in raw_lower

        dq = 1
        if "display" in parsed: dq += 1
        if len(keys) >= 4: dq += 1
        if relevant: dq += 1
        if len(keys) >= 6: dq += 1

        print(f"  Valid JSON      : YES")
        print(f"  display field   : {display}")
        print(f"  Target relevant : {'YES' if relevant else 'SUSPECT - check raw'}")
        print(f"  Data quality    : {min(dq, 5)}/5")
        print(f"  Keys            : {keys}")
        pretty = json.dumps(parsed, indent=2)
        if len(pretty) > 900:
            pretty = pretty[:900] + "\n  ...(truncated)"
        print(f"\n  PARSED:\n{pretty}")
    else:
        print(f"  Valid JSON      : NO")
        print(f"  Data quality    : 1/5")
        print(f"  Raw (500 chars) : {raw[:500]}")


# Create tasks sequentially (no parallel create to avoid rate limits)
print("=== Creating Manus tasks ===", flush=True)
results = {}
threads = []
for test in TESTS:
    t = threading.Thread(target=run_test, args=(test, results))
    t.start()
    threads.append(t)
    time.sleep(0.5)

for t in threads:
    t.join()

print("\n=== Results ===")
for test in TESTS:
    report(test, results)

print("\n\n=== Done ===")
