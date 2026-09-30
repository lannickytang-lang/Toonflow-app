// 从 packages/tools/canvas/src/runtime.ts 的 canvasOperations 权威注册表，
// 生成技能内 server 能力清单 packages/skills/tdd/references/api.md（随技能包分发，真实用户本地可读）。
// 用法：bun scripts/genApiDoc.ts           生成/刷新 api.md
//       bun scripts/genApiDoc.ts --check   只比对，漂移时退出 1（selfcheck 发布门禁调用）
import { readFileSync, writeFileSync } from "node:fs";
import { canvasOperations } from "../packages/tools/canvas/src/runtime";

const target = new URL("../packages/skills/tdd-auto/references/api.md", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function typeNameOf(value: unknown): string {
  const def = (value as { _def?: { typeName?: string }; def?: { type?: string } })?._def
    ?? (value as { def?: { type?: string } })?.def;
  return def?.typeName ?? (def as { type?: string } | undefined)?.type ?? "";
}

function describeField(value: unknown, depth: number): string[] {
  const optional = (value as { safeParse?: (input: unknown) => { success: boolean } }).safeParse?.(undefined)?.success === true;
  let inner = value;
  // 解开 Optional/Default 包装（zod 3 为 ZodOptional，zod 4 为小写 optional）
  for (let guard = 0; guard < 3; guard++) {
    const type = typeNameOf(inner);
    if (["ZodOptional", "ZodDefault", "optional", "default"].includes(type)) {
      inner = (inner as { _def?: { innerType?: unknown }; def?: { innerType?: unknown } })._def?.innerType
        ?? (inner as { def?: { innerType?: unknown } }).def?.innerType ?? inner;
    } else break;
  }
  const type = typeNameOf(inner);
  const pad = "  ".repeat(depth + 1);
  const rows: string[] = [];
  let hint = "";
  if (type === "ZodString") hint = "string";
  else if (type === "ZodNumber") hint = "number";
  else if (type === "ZodBoolean") hint = "boolean";
  else if (type === "ZodArray") {
    hint = "array";
    const element = (inner as unknown as { _def?: { type?: unknown }; def?: { type?: unknown } })._def?.type
      ?? (inner as unknown as { def?: { type?: unknown } }).def?.type;
    if (element && typeNameOf(element) === "ZodObject") rows.push(...describeObject(element, depth + 1, true));
  } else if (type === "ZodObject") hint = "object";
  else hint = type.replace(/^Zod/, "").toLowerCase() || "unknown";
  rows.unshift(`${pad}- ${hint}${optional ? "（可选）" : ""}`);
  return rows;
}

function describeObject(schema: unknown, depth: number, asElement = false): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  if (!shape) return [];
  const pad = "  ".repeat(depth);
  const rows: string[] = asElement ? [] : [`${pad}字段：`];
  for (const [key, value] of Object.entries(shape)) {
    rows.push(`${pad}- ${key}:`);
    rows.push(...describeField(value, depth));
  }
  return rows;
}

const lines = [
  "# server 画布操作能力清单（权威提取）",
  "",
  "> 本文件由权威注册表自动生成，**勿手改**，发布门禁会校验一致性。",
  "> 这是 MCP 与 CLI 共用的操作全集——据此可发现 CLI 尚未暴露的能力。",
  "> 逃生通道：CLI 未暴露的操作可直接 `POST http://127.0.0.1:3000/api/canvas/operation`，",
  '> body {"directory": "<工作区>", "name": "<操作名>", "args": {…}}，请求头须带 `Origin: http://127.0.0.1:3000` 与 `x-toonflow-workspace: 1`；',
  "> args 结构按下方各操作的字段。除画布操作外 server 还有队列（/api/queue/*）、设置（/api/settings/*）、项目（/api/projects/*）等接口，CLI 命令即其封装。",
  "",
];

for (const operation of canvasOperations) {
  lines.push(`## ${operation.name}`, "", operation.description, "");
  const fieldRows = describeObject(operation.parameters, 0);
  if (fieldRows.length) lines.push(...fieldRows, "");
}

const content = lines.join("\n");
if (process.argv.includes("--check")) {
  const existing = readFileSync(target, "utf-8");
  if (existing !== content) {
    console.error(`api.md 与 runtime.ts 漂移：运行 bun scripts/genApiDoc.ts 重新生成后发布`);
    process.exit(1);
  }
  console.log("api.md 与 runtime.ts 一致");
} else {
  writeFileSync(target, content, "utf-8");
  console.log(`api.md 已生成（${canvasOperations.length} 个操作）`);
}
