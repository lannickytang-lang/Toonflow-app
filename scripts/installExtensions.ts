#!/usr/bin/env bun
// Toonflow 一键安装（零参数）：
//   1. 自动探测本机 agent 宿主（claude/codex/zcode/agents 等）技能目录，装入 canvasOperation / toonflowCli 技能；
//   2. 从分发中心（tudodo-center）全量拉取 Toonflow 侧插件（技能/供应商/工具），版本一致自动跳过。
// 参数：--hosts d1,d2 显式指定宿主技能目录 | --force 覆盖重装 | --mirror <中心基址> | --toonflow-only / --hosts-only
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 直接运行时以本文件位置推导根目录；被 CLI 内置调用时由调用方传入（编译版 spawn 不到外部脚本）。
const sourceRoot = join(import.meta.dir, "..");

export type InstallArgs = { args: Set<string>; value: (name: string) => string | undefined; rootDirectory: string };

export async function runInstall({ args, value: argValue, rootDirectory }: InstallArgs): Promise<number> {
const defaultMirror = "https://gitee.com/comtudodo/tudodo-center/raw/master";
const mirror = argValue("mirror") ?? defaultMirror;
const dataDirectory = join(rootDirectory, "data");
const force = args.has("--force");

const hostCandidates = [
  { id: "claude", skillsDirectory: join(homedir(), ".claude", "skills") },
  { id: "codex", skillsDirectory: join(homedir(), ".codex", "skills") },
  { id: "zcode", skillsDirectory: join(homedir(), ".zcode", "skills") },
  { id: "agents", skillsDirectory: join(homedir(), ".agents", "skills") },
];

function report(entry: { category: string; name: string; action: string; detail?: string }) {
  installed.push(entry);
  console.log(`[${entry.action}] ${entry.category}/${entry.name}${entry.detail ? `（${entry.detail}）` : ""}`);
}

const installed: { category: string; name: string; action: string; detail?: string }[] = [];

async function fetchText(url: string) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}: ${url}`);
  return response.text();
}

async function fetchBinary(url: string) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** 中心 zip 解压（store/deflate 均支持），返回 相对路径 -> 内容 字节。 */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name.endsWith("/")) {
      // 目录项跳过
    } else if (method === 0) {
      files.set(name, data);
    } else if (method === 8) {
      // Bun 原生 inflate 走 Blob 消费；deflate 解压用 DecompressionStream("deflate-raw")。
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error(`不支持的 zip 压缩方法 ${method}: ${name}`);
    offset = dataStart + compressedSize;
  }
  return files;
}

async function localSkillVersion(skillsRoot: string, name: string) {
  const path = join(skillsRoot, name, "SKILL.md");
  if (!existsSync(path)) return "";
  const match = /version:\s*([^\s]+)/.exec(await Bun.file(path).text());
  return match?.[1] ?? "";
}

async function installHostSkills() {
  const hostsArgument = argValue("hosts");
  const hosts = hostsArgument
    ? hostsArgument.split(",").map(directory => ({ id: directory, skillsDirectory: directory }))
    : hostCandidates.filter(host => existsSync(host.skillsDirectory));
  if (!hosts.length) {
    console.log("未探测到 agent 宿主技能目录（claude/codex/zcode/agents），跳过宿主安装；用 --hosts <目录> 显式指定");
    return;
  }
  const skills = ["canvasOperation", "toonflowCli"];
  for (const host of hosts) {
    for (const name of skills) {
      try {
        const target = join(host.skillsDirectory, name);
        const local = await localSkillVersion(host.skillsDirectory, name);
        // 版本从 zip 内 SKILL.md 读取，避免单独请求。
        const zip = await unzip(await fetchBinary(`${mirror}/dist/skills/${name}.zip`));
        const skillEntry = [...zip.entries()].find(([path]) => path.endsWith("SKILL.md"));
        if (!skillEntry) throw new Error("zip 内无 SKILL.md");
        const remoteVersion = /version:\s*([^\s]+)/.exec(new TextDecoder().decode(skillEntry[1]))?.[1] ?? "";
        if (!force && local && local === remoteVersion) {
          report({ category: `宿主/${host.id}`, name, action: "跳过", detail: `已同版本 ${local}` });
          continue;
        }
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        for (const [path, content] of zip) {
          const relative = path.split("/").slice(1).join("/");
          if (!relative) continue;
          const destination = join(target, relative);
          mkdirSync(join(destination, ".."), { recursive: true });
          writeFileSync(destination, content);
        }
        report({ category: `宿主/${host.id}`, name, action: force ? "覆盖安装" : "安装", detail: remoteVersion });
      } catch (error) {
        report({ category: `宿主/${host.id}`, name, action: "失败", detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

async function installToonflowSide() {
  const manifest = JSON.parse(await fetchText(`${mirror}/manifest.json`)) as {
    skills: { name: string; version: string; file: string }[];
    providers: { name: string; version: string; file: string }[];
    tools: { name: string; version: string; file: string }[];
  };
  for (const skill of manifest.skills) {
    const target = join(dataDirectory, "skills", skill.name);
    const local = await localSkillVersion(join(dataDirectory, "skills"), skill.name);
    if (!force && local && local === skill.version) {
      report({ category: "Toonflow/技能", name: skill.name, action: "跳过", detail: `已同版本 ${local}` });
      continue;
    }
    const zip = await unzip(await fetchBinary(`${mirror}/${skill.file}`));
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const [path, content] of zip) {
      const relative = path.split("/").slice(1).join("/");
      if (!relative) continue;
      const destination = join(target, relative);
      mkdirSync(join(destination, ".."), { recursive: true });
      writeFileSync(destination, content);
    }
    report({ category: "Toonflow/技能", name: skill.name, action: force ? "覆盖安装" : "安装", detail: skill.version });
  }
  for (const provider of manifest.providers) {
    const target = join(dataDirectory, "providers", `${provider.name}.ts`);
    const local = existsSync(target) ? /const version = "([^"]+)"/.exec(await Bun.file(target).text())?.[1] ?? "" : "";
    if (!force && local && local === provider.version) {
      report({ category: "Toonflow/供应商", name: provider.name, action: "跳过", detail: `已同版本 ${local}` });
      continue;
    }
    const source = await fetchText(`${mirror}/${provider.file}`);
    // 发布门禁同款语法校验，防止坏源码进 data。
    new Bun.Transpiler({ loader: "ts" }).scan(source);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, source, { encoding: "utf8" });
    report({ category: "Toonflow/供应商", name: provider.name, action: force ? "覆盖安装" : "安装", detail: provider.version });
  }
  for (const tool of manifest.tools) {
    const target = join(dataDirectory, "tools", tool.file.split("/").pop()!);
    const local = existsSync(target) ? /"version":\s*"([^"]+)"/.exec(await Bun.file(target).text())?.[1] ?? "" : "";
    if (!force && local && local === tool.version) {
      report({ category: "Toonflow/工具", name: tool.name, action: "跳过", detail: `已同版本 ${local}` });
      continue;
    }
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, await fetchText(`${mirror}/${tool.file}`), { encoding: "utf8" });
    report({ category: "Toonflow/工具", name: tool.name, action: force ? "覆盖安装" : "安装", detail: tool.version });
  }
}

const summary = { installed: 0, skipped: 0, failed: 0 };
  if (!args.has("--hosts-only")) await installToonflowSide();
  if (!args.has("--toonflow-only")) await installHostSkills();
  for (const entry of installed) {
    if (entry.action === "跳过") summary.skipped++;
    else if (entry.action === "失败") summary.failed++;
    else summary.installed++;
  }
  console.log(`\n完成：安装 ${summary.installed}、跳过 ${summary.skipped}${summary.failed ? `、失败 ${summary.failed}` : ""}`);
  console.log("技能已装入你的技能目录（新会话或刷新技能列表后可原生发现 toonflowCli / canvasOperation）");
  return summary.failed ? 5 : 0;
}

// ---- 直接运行入口 ----
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const directArgs = new Set(argv.filter(arg => arg.startsWith("--")));
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  try {
    process.exit(await runInstall({ args: directArgs, value, rootDirectory: sourceRoot }));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`hint: 检查网络与镜像地址（--mirror），默认 ${defaultMirror}`);
    process.exit(2);
  }
}
