import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { applyCanvasOperation } from "@/utils/canvas/ops";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

const bodySchema = z.object({
  directory: z.string().min(1).max(4096),
  canvasId: z.string().min(1).max(256).optional(),
  connectionId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(64),
  args: z.record(z.string(), z.json()).default({}),
});

// CLI/HTTP 传输层的通用画布操作端点：与 MCP 画布工具同一实现（applyCanvasOperation），
// name 取值与 MCP 工具一致（getCanvas/addNode/connectNodes/importStoryboard/nodeTools/…）。
export default router.post("/", validateFields(bodySchema.shape), async (req, res) => {
  const { directory, canvasId, connectionId, name, args } = bodySchema.parse(req.body);
  await u.workspace.ensureWorkspaceDirectory(req, directory);
  // 页面动作通道：显式 connectionId 优先，否则取该工作区的唯一页面连接（fitCanvas 截图排查用）。
  const { listConnections, getConnection, callControl } = await import("@/utils/mcp/control");
  let resolvedConnection = connectionId;
  if (!resolvedConnection) {
    // CLI 常传正斜杠而页面上报反斜杠，Windows 下大小写也不敏感：统一归一后比较。
    const normalize = (value: string | null) => value?.split("\\").join("/").toLowerCase();
    const matches = listConnections().filter(connection => normalize(connection.state.directory) === normalize(directory));
    if (matches.length === 1) resolvedConnection = matches[0]!.id;
  }
  const pageCall = resolvedConnection
    ? (pageRequest: { name: string; args: Record<string, unknown> }, signal: AbortSignal) => {
        getConnection(resolvedConnection);
        // directory 一致性已在上方归一化匹配时确认，不再传给 callControl 重复校验（斜杠差异会误报）。
        return callControl(resolvedConnection, pageRequest.name, pageRequest.args, signal);
      }
    : undefined;
  const result = await applyCanvasOperation(directory, canvasId, { name, args }, AbortSignal.timeout(600000), pageCall);
  res.json(success(result));
});
