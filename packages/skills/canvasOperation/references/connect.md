# 连接与状态

## 前提

画布操作需要**已打开的 Toonflow 页面**(桌面应用或浏览器网页),且页面已打开项目、激活画布。无页面连接时只有服务端文件、技能和媒体能力可用(通过 `target.directory` 指定绝对工作目录)。

MCP **默认开启且免鉴权**(仅本机回环监听):直接连 `http://127.0.0.1:10588/mcp`,无需凭证。连不上时按端口顺延逐个探测(10589、10590…,首选端口被占用时 Toonflow 自动顺延监听)。连接被拒(401/403)说明用户开启了「访问鉴权」——请用户在 设置 → MCP 复制带凭证的 HTTP 配置后重试(携带 `Authorization: Bearer <凭证>`)。

## 连接方式

- **Streamable HTTP**(免鉴权,推荐):
  ```json
  { "mcpServers": { "toonflow": { "url": "http://127.0.0.1:10588/mcp" } } }
  ```
  开启鉴权时另加 `headers: { "Authorization": "Bearer <凭证>" }`(凭证在 Toonflow「设置 → MCP」复制)。
- **stdio**:由 Toonflow「设置 → MCP」的「复制 stdio 配置」生成。

## getAppState:每次会话的第一步

调用 `getAppState`(无参数),返回:

```json
{
  "connections": [{
    "id": "<connectionId>",
    "state": {
      "directory": "<工作目录绝对路径>",
      "canvasId": "<激活画布 id,如 画布1.json>",
      "panel": "canvas",
      "tools": [{"nodeId": "...", "name": "node:generateImage", "description": "...", "parameters": {}}]
    }
  }],
  "workspaceRoot": "<服务器部署允许的工作区根目录>"
}
```

- 多个页面连接时,后续调用必须用 `target: { connectionId }` 明确操作对象
- 画布相关工具需要页面连接;`target.directory` 为服务端直跑工具(文件、媒体)指定工作目录
- 页面切换项目或画布后,重新调用 `getAppState` 刷新状态

## target 语义

所有业务工具的入参为 `{ target: { connectionId?, directory?, canvasId? }, args: {...} }`:

- `connectionId`:指定操作哪个页面(多页面时必填)
- `directory`:指定工作目录(服务端直跑工具需要;画布工具可省略)
- `canvasId`:校验目标画布未切换

## 页面未连接时:openApp

调用 `openApp`(args 为空对象),server 会用系统默认浏览器打开 Toonflow 工作区页面:

```
调用 openApp → 等待几秒页面加载 → 重新 getAppState → 继续原操作
```

已知限制:独立 dev server(源码 `bun run dev:server`,端口 3000)不托管前端页面,此时 openApp 打开的地址无效;桌面与生产部署不受影响。开发环境下请直接使用前端 dev 地址(如 `http://localhost:5173/#/workspace`)。

## 已知限制:独立 dev server

源码方式运行独立 dev server(`bun run dev:server`,端口 3000)时不托管前端页面,`openApp` 会明确报错并引导使用前端 dev 地址(默认 `http://localhost:5173/#/workspace`);桌面与生产部署不受影响,`openApp` 正常打开。

## 页面状态排障

- **优先用 `127.0.0.1` 而非 `localhost` 访问页面**:部分环境 `localhost` 解析异常(IPv6/代理)会导致页面资源加载不完整,表现为连接无状态、画布不激活、命令超时;遇到这类现象,先让用户改用 `http://127.0.0.1:<端口>/#/workspace` 重新打开
- **画布自动激活**:页面加载并打开项目后,画布会在数秒内自动激活;`getAppState` 的 canvasId 由空变为画布 id 即就绪。若长时间为空,提示用户在页面顶部「选择画布」下拉手动选择,或从项目列表重新进入项目
- **命令超时**:若控制命令报「已取消或超时(页面可能切到后台或无响应)」,说明页面处于后台或失去响应——让用户把 Toonflow 页面切回前台,或调用 `openApp` 重新打开后再重试
- **多页面/多标签**:每个打开的 Toonflow 页面是独立连接;命令只发给指定的 `connectionId`。连接行为异常时,提示用户关闭多余的 Toonflow 标签页,保留一个后重试
- **新项目**:openProject 的 directory 不存在时会自动创建(服务器部署限 data/workspaces 内),无需用户先在界面建项目
