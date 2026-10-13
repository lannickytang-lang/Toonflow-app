// 直跑 jimeng.ts provider（不经 server 沙箱），console 直出进度
const mod = await import("./jimeng.ts");
const mode = process.argv[2] ?? "canvasNode";
const ctx = {
  config: {
    submitMode: mode,
    userDataDir: "D:\\tjs\\code\\ws\\Toonflow-app\\packages\\cli\\agent-harness\\providerWork\\jimengProbeOut\\jimengProfile",
    debugPort: "9333",
  },
  signal: AbortSignal.timeout(560_000),
  tool: { fetch: globalThis.fetch },
};
const provider = (mod as any).default;
// 污染 sleep/等待期间的进度可见性：直接调用
console.log("[driver] mode:", mode);
try {
  const assets = await provider.generateImage.call(ctx, {
    model: "seedream_4.1",
    prompt: "一只橘猫坐在月光下的屋顶，像素画风格",
    ratio: "16:9",
  });
  console.log("[driver] ASSETS:", JSON.stringify(assets, null, 1));
} catch (e: any) {
  console.error("[driver] ERROR:", e.message);
}
process.exit(0);
