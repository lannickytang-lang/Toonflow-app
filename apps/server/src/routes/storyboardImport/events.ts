import { Router } from "express";
import u from "@/utils";
import { addStoryboardImportClient, removeStoryboardImportClient } from "@/utils/storyboardImport/events";

export default Router().get("/", (req, res) => {
  // ACT: 原生 EventSource 无自定义请求头；与 ffmpeg/events 一致仅做同源校验。
  u.mcpControl.getAppOrigin(req);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(": connected\n\n");
  addStoryboardImportClient(res);
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20000);
  const socket = req.socket;
  const close = () => {
    clearInterval(heartbeat);
    removeStoryboardImportClient(res);
    res.off("close", close);
    socket.off("close", close);
  };
  res.once("close", close);
  socket.once("close", close);
});
