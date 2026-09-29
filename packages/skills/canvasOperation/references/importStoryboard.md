# 分镜导入(importStoryboard)

把已推理好的分镜脚本按标准 JSON 一次导入画布:自动创建资产节点与分镜视频节点、按出镜关系连线、自动排列并适应视图。**一次调用完成整个画布搭建**,替代几十次逐节点调用。

## 导入前必查:模型与可选项(最常见失败原因)

`options.videoModel / duration / resolution` **不要猜**。导入中途 setConfig 参数不被模型支持会报错并留下半成品画布。导入前先查一次:

**查全局模型清单(推荐,一次拿全):**

```
appOperation(name="listMediaProviders", parameters={})
```

返回全部供应商及其模型,每个模型带能力声明:

```json
{
  "id": "mockProvider",
  "models": [
    { "id": "mockImage", "type": "image", "imageRatios": ["1:1","4:3","3:4","16:9","9:16"], "imageSizes": ["1K","2K"] },
    { "id": "mockVideo", "type": "video", "mode": ["text","singleImage","startEndRequired","endFrameOptional","startFrameOptional",["imageReference:10","videoReference:5","audioReference:5"]], "durationResolutionMap": [{ "duration": [1..60], "resolution": ["480P","720P","1080P"] }] }
  ]
}
```

- `options.videoModel.providerId/modelId`:从 `type` 匹配视频模型(如 `mockVideo`),providerId 取供应商 `id`
- `options.duration / resolution`:必须是该模型 `durationResolutionMap` 中**同一组合**里的值(注意大小写精确,如 `480P` 而非 `480p`);省略时用节点当前配置
- 图片模型的 `imageRatios / imageSizes` 对应节点生成时的比例与尺寸

**查节点视角(已导入后微调时用):**

```
nodeTools(nodeId=<视频节点>, name="node:getConfig", args={})
```

返回该节点当前配置与可选模型列表;`node:setConfig` 修改前先用它确认可选值。

## 标准 JSON 契约

```json
{
  "assets": [
    { "name": "小女孩", "imagePrompt": "一个勇敢的小女孩,红色围巾,卡通风格", "filePath": "assets/小女孩.png" },
    { "name": "魔法森林", "imagePrompt": "神秘的魔法森林,黄昏光线,卡通风格" }
  ],
  "scenes": [
    { "sortNum": 1, "videoPrompt": "小女孩走进森林,回头张望,镜头缓缓推进", "cast": ["小女孩", "魔法森林"] },
    { "sortNum": 2, "videoPrompt": "森林深处发光的精灵环绕小女孩飞舞", "cast": ["小女孩", "魔法森林"] }
  ],
  "options": {
    "autoGenerateImages": false,
    "imageModel": { "providerId": "mockProvider", "modelId": "mockImage" },
    "videoModel": { "providerId": "mockProvider", "modelId": "mockVideo" },
    "duration": 5,
    "resolution": "480P"
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `assets[].name` | 资产名,必填,也是 cast 连线的匹配键 |
| `assets[].imagePrompt` | 生图提示词;有 filePath 时可省略 |
| `assets[].filePath` | 已有参考图,工作区相对路径(需先用 workspaceFiles 写入) |
| `scenes[].sortNum` | 分镜序号(整数),决定节点创建顺序 |
| `scenes[].videoPrompt` | 视频生成提示词,必填 |
| `scenes[].duration` | 该分镜的视频时长(可选),优先于 options.duration;各分镜时长不同时用它逐个指定,不必导入后再 setConfig |
| `scenes[].cast` | 出镜资产 name 列表;导入后从资产 image 端口连线到视频 in 端口。**数量受视频模型参考能力约束**:纯文本=0、单图=1、首尾帧=2、多参考按模型声明上限(如 mockVideo 支持最多 10 图 + 5 视频 + 5 音频);超出会在建边前报错并列出冲突分镜 |
| `options.autoSubmit` | true 时导入后立即把画布全部未完成生成任务提交队列(scope=missing 幂等,可用于断点重建) |
| `options.autoGenerateImages` | true 时在画布完整搭建(全部节点+连线+排列)之后统一启动生图(默认 false);生成失败不影响已建好的画布结构 |
| `options.imageModel` | 图片生成节点的模型(providerId + modelId 必须同时提供);autoGenerateImages 为 true 时建议同时提供,否则依赖节点默认模型 |
| `options.videoModel` | 分镜视频节点的模型(providerId + modelId 必须同时提供) |
| `options.duration` / `options.resolution` | 视频时长与分辨率;枚举以模型能力为准,大小写必须精确(如 `480P` 而非 `480p`);mockVideo 支持 1~60 秒任意整数时长 |

## 节点创建规则

- 资产:有 `filePath` 且图片节点可用 → 建图片节点直接引用文件(按扩展名推断 mimeType);否则 → 建图片生成节点(prompt=imagePrompt;仅有 filePath 时提示词注明参考图;imageModel 有值时同步 setConfig)
- 分镜:按 sortNum 升序建视频生成节点(prompt=videoPrompt;videoModel/duration/resolution 有值时同步 setConfig);首个视频节点配置完成后会做一次 cast 容量校验,超限分镜在建边前报错
- 全部建完后连线 + `arrangeCanvas` 自动排列 + `fitCanvas` 适应视图;最后才执行 autoGenerateImages 的生图触发
- **返回**:`assetNodeIds`(**`[{name, nodeId}]` 数组**,不是映射)、`sceneNodeIds`(**`[{sortNum, nodeId}]` 数组**)、`edgeIds`、`arrangedNodeIds`、`workspaceDirectory`

## 推荐流程

1. `getCanvas` 确认激活画布与可用节点类型(是否已有 imageGenerationNode / videoGenerationNode;videoGenerationNode 缺失会直接报错)
2. **`appOperation`(name=`listMediaProviders`)查询模型与可选项**,确定 options 的 videoModel/duration/resolution(见上文"导入前必查")
3. 参考 图(若有):先用 `workspaceFiles`(action=writeBinary,base64 ≤ 20MB)把资产图片写入工作区,得到相对路径
4. 构造标准 JSON,调用 `importStoryboard`
5. 核对返回的节点/边数量与 JSON 一致

## 单点微调

导入后修改某个节点:用 `nodeTools`(`node:setPrompt`、`node:setConfig`)与 `moveNodes`/`connectNodes`/`deleteNodes`,不要重跑整个导入。

## 失败与恢复(重要)

导入**非事务性**:中途失败(如 setConfig 的分辨率不被模型支持)会保留已创建的节点。处理方式:

- 读错误信息修正 JSON(错误会列出可选值,如 `当前时长不支持分辨率 480p,可选:480P、720P、1080P`)
- `getCanvas` 查看已建节点,选择:清理(`deleteNodes`)后重跑完整导入,或直接对已建节点用单点操作补齐
- 用户在 Toonflow 界面也可以撤销(Ctrl+Z,整批一个撤销步)
