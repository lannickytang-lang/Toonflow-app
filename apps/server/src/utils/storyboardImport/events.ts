import type { Response } from "express";

type StoryboardImportPayload = { assets: Array<Record<string, unknown>>; scenes: Array<Record<string, unknown>> };

// ACT: 广播只属于当前单进程；推送时若无连接方,调用方(push 接口)会收到 delivered=0 并向上反馈。
const clients = new Set<Response>();

export function addStoryboardImportClient(res: Response) {
  clients.add(res);
}

export function removeStoryboardImportClient(res: Response) {
  clients.delete(res);
}

export function connectedStoryboardImportClients() {
  return clients.size;
}

export function broadcastStoryboardImport(payload: StoryboardImportPayload) {
  const data = `data: ${JSON.stringify({ type: "storyboardImport", ...payload })}\n\n`;
  for (const res of clients) {
    if (!res.destroyed) res.write(data);
  }
  return clients.size;
}
