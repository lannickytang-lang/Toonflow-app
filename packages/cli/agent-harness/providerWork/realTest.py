import json, sys, urllib.request
# 用法: python realTest.py normal|canvasNode|agent|dryrun:<mode>
#   dryrun:<mode> 用 jimengSamples.json 干跑（请求不出网、不操作浏览器）
arg = sys.argv[1] if len(sys.argv) > 1 else "normal"
dryrun = arg.startswith("dryrun:")
mode = arg.split(":", 1)[1] if dryrun else arg
source = open("jimeng.ts", encoding="utf-8").read()
config = {
    "submitMode": mode,
    "userDataDir": r"D:\tjs\code\ws\Toonflow-app\packages\cli\agent-harness\providerWork\jimengProbeOut\jimengProfile",
    "debugPort": "9333",
}
if dryrun:
    config["dryrun"] = True
body = {"source": source, "config": config,
        "request": {"model": "seedream_4.1", "prompt": "一只橘猫坐在月光下的屋顶，像素画风格", "ratio": "16:9"}}
if dryrun:
    body["mock"] = {"samples": json.load(open("jimengSamples.json", encoding="utf-8"))}
req = urllib.request.Request("http://127.0.0.1:47392/api/providers/debug/run",
    data=json.dumps(body).encode(), method="POST",
    headers={"Content-Type": "application/json", "Accept": "application/x-ndjson",
             "x-toonflow-workspace": "1", "Origin": "http://127.0.0.1:47392"})
print(f"[realTest {arg}] started", flush=True)
with urllib.request.urlopen(req, timeout=1830) as response:
    for line in response:
        line = line.decode("utf-8", errors="replace").strip()
        if not line: continue
        try: event = json.loads(line)
        except ValueError: continue
        t = event.get("type")
        if t == "log":
            log = event.get("log", {})
            print(f"[{log.get('id')}] {log.get('method')} {str(log.get('url'))[:110]} -> {log.get('state')} {log.get('status','')}", flush=True)
            resp = str(log.get("response", ""))[:200].replace("\n", " ")
            if resp: print(f"      resp: {resp}", flush=True)
        elif t == "result":
            print("RESULT:", json.dumps(event, ensure_ascii=False)[:800], flush=True)
        elif t == "error":
            print("ERROR:", event.get("message"), flush=True)
        else:
            print("EVENT:", json.dumps(event, ensure_ascii=False)[:300], flush=True)
print("[realTest] done", flush=True)
