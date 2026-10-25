# Ball Chess Agent 决策接口设计

**日期：** 2026-10-25

## 目标

让 Agent 在不接受策略提示的前提下，直接、无歧义地读取当前局面，复制一个合法行动并提交，同时可以按需读取可重放的完整棋谱。接口继续以服务端规则为唯一权威，不要求 Agent 从 ASCII 棋盘推导合法性。

## 设计边界

- 本次只改善事实表达、行动引用和棋谱读取，不输出最佳步、局面评分、胜率、搜索树、最短路径或威胁排序。
- HTTP 程序 bot 接口继续接受结构化 `action`；MCP 与 DSH 面向 LLM 的 `submit_action` 改为接受可复制的 `actionId`。
- 墙数量、先手、回合上限和超时始终来自本局配置，提示词不保存固定副本。
- 绝对坐标保持不旋转；Agent 同时收到 `left/right` 和 `you/opponent` 视角别名。
- 完整棋谱按需读取，不重复放入每个回合状态。

## 规范化行动 ID

行动 ID 与现有结构化行动一一对应：

- `move:up`
- `move:down`
- `move:left`
- `move:right`
- `wall:h:<x>:<y>`
- `wall:v:<x>:<y>`

`formatActionId(action)` 和 `parseActionId(actionId)` 必须可逆。解析器只接受上述规范格式；坐标范围继续由核心规则和当前合法行动判定。MCP/DSH 在提交前解析行动 ID，再调用现有 HTTP `expectedVersion + action` 接口。

## Agent 决策状态

`projectState()` 保留当前无凭据状态，并增加 `decision`：

- `actor`：`you`、`opponent`、`currentPlayer`、`yourTurn`；`you/opponent` 含绝对席位、颜色、位置、目标行和墙配额。
- `coordinates`：原点、x/y 增长方向，以及 `h/v` 墙准确阻断边的公式和示例。
- `legalActions`：移动条目包含 `id`、原结构化 `action` 和目标格 `to`；墙仍按方向及 y 行无损压缩，并声明 ID 构造格式与合法总数。

现有 `legalActionList` 暂时保留，避免破坏结构化消费者。文本输出以 `decision` 为主，ASCII 棋盘增加 x/y 坐标标签并保留为辅助视图。

墙坐标语义固定为：

- `wall:h:x:y` 阻断 `(x,y-1)↔(x,y)` 与 `(x+1,y-1)↔(x+1,y)`。
- `wall:v:x:y` 阻断 `(x-1,y)↔(x,y)` 与 `(x-1,y+1)↔(x,y+1)`。

## 完整棋谱工具

新增 `get_match_record`：

- 只允许已经绑定席位的 MCP/DSH 会话调用。
- 复用公开的 `GET /api/matches/:id/record`，不传输或持久化新的凭据。
- 返回配置、创建/更新时间、逐手 `ply/player/action/actionId/at` 和终局结果。
- 文本输出使用相同行动 ID，便于模型、用户和日志交叉核对。
- DSH 已终局的无凭据回执仍可根据配置的本机服务地址与回执中的 `matchId` 读取棋谱。

## 提交与失败处理

`submit_action` 的模型参数改为：

```json
{
  "expectedVersion": 18,
  "actionId": "wall:v:3:4"
}
```

无效格式返回明确错误，不发 HTTP 行动请求。合法格式解析后仍由服务端根据当前版本和当前局面判定是否合法。`STALE_STATE`、`ILLEGAL_ACTION` 等现有恢复语义保持不变，并返回最新决策状态。

## 压缩与提示词

DSH persona 改为要求复制当前决策包中的 `actionId`。Ball Chess 压缩摘要保存坐标语义版本、最近权威行动 ID 和待执行工具，但不保存推荐行动。规则与动态墙配额继续从权威工具输出读取。

## 验收

- 单元测试证明所有行动 ID 可逆，非法格式被拒绝。
- 投影测试证明左右席位获得语义对称的 `you/opponent` 数据，移动包含准确目标格。
- 墙测试覆盖横墙和竖墙的阻断边说明及可提交 ID。
- MCP 与 DSH 测试通过 `actionId` 完成行动，并能读取完整棋谱。
- 端到端测试完成包含横墙和竖墙的对局，验证棋谱可按顺序重放到相同终局或最终局面。
- 模型可见文本与文档不包含固定墙数或策略分析字段。
