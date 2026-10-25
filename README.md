# Ball Chess

本地运行的 9 × 13 双人放墙竞速游戏。浏览器使用原生 HTML/CSS/JavaScript/SVG，无前端依赖、无需构建；Node 服务统一负责规则、持久化、HTTP、SSE 与 MCP 接入。

## 规则速览

- 左下为 `(0, 0)`；左侧红球从 `(2, 0)`、右侧蓝球从 `(6, 0)` 出发，先到顶行 `y = 12` 的任意格获胜。
- 双方轮流行动，每次四向移动一格，或放置一块墙；不能斜走、跳跃、进入对方所在格或主动跳过。
- 横墙与竖墙都覆盖两条单位格边。墙不可重叠或十字交叉，允许首尾相连和合法 T 形连接；放墙后双方都必须保留到顶边的路径。
- 默认无限墙（`wallLimit = null`），可配置每方有限墙。默认最多 300 手（`maxPlies = 300`）；先判断顶边胜利，再判断行动上限和棋。
- 默认左侧先手，可配置右侧或随机。轮到一方时若完全无合法行动，该方判负。
- 默认不限回合时间；`turnTimeoutMs` 可配置为 1 至 2,147,483,647 毫秒。处理请求时若已到截止时间，服务端先结算超时，恰好在截止时刻到达的行动也不会被接受。管理员也可中止对局。
- 非法行动、过期版本和越权请求不会消耗回合或改变棋谱。

## 安装、测试与启动

要求 Node.js 22 或更新版本。Windows Git Bash 使用 `npm.cmd`；PowerShell 中可写成 `npm`。

```bash
npm.cmd install
npm.cmd test
npm.cmd run dev -- --host 127.0.0.1 --port 7100
```

启动后打开 <http://127.0.0.1:7100>。默认监听地址就是 `127.0.0.1:7100`，也可直接运行：

```bash
npm.cmd run dev
```

`--host` 与 `--port` 会转发给 Node 服务。前端没有打包或编译步骤。

## 人类对局与观战

1. 在“开始一局”中选择自己的席位，或选择“仅管理/观战”；设置规则后创建。
2. 等待阶段由管理员为空席生成邀请码。复制出的自然语言指令是“加入邀请码 … 并开始”，人类、MCP 和 DSH 使用同一种邀请。
3. 另一名玩家在开始页输入邀请码；只读观战则输入对局 ID。`matchId + playerToken` 仅保留在折叠的高级兼容入口中。
4. 玩家占席后点击“准备”；开局前可取消，双方都准备后才原子开始第一回合。
5. 进行阶段只保留棋盘、行动方、计时、墙数和行动反馈。棋盘只有一个键盘焦点：方向键选择预览，`M` 切换移动/放墙，`R` 旋转墙，Enter 确认，Escape 取消；鼠标和触摸仍可直接选择。
6. 结束阶段从 `/record` 读取完整权威棋谱，并提供“创建新对局”。SSE 只通知页面刷新；并发通知会合并为一次状态请求，旧版本或旧对局响应不能回滚界面。

浏览器只保存恢复当前身份所需的对局 ID、角色/席位和自己的凭证，不保存另一个席位的凭证。数据位于当前源的 `localStorage["ballChess.activeMatch.v2"]`，请勿在不受信任的浏览器或共享账户中保留。

## 程序 bot

先通过页面或 `POST /api/matches` 创建对局。创建接口不会返回整组玩家令牌；管理员可暂时通过 `GET /api/matches/:id/setup` 取得兼容用席位令牌，然后为每个席位运行独立客户端。bot 会依次占席、发送 ready，再进入行动循环。以下示例适用于 Git Bash：

```bash
node examples/bot.js --url http://127.0.0.1:7100 --match "$MATCH_ID" --token "$LEFT_TOKEN" --strategy greedy
node examples/bot.js --url http://127.0.0.1:7100 --match "$MATCH_ID" --token "$RIGHT_TOKEN" --strategy random --seed 2
```

可选参数：`--strategy greedy|random`、`--seed <整数>`、`--poll-ms <毫秒>`。bot 只使用服务端返回的 `legalActions`，不自行复制墙体或路径规则。

主要 HTTP 接口：

| 方法与路径 | 用途 |
|---|---|
| `POST /api/matches` | 以 `{ config, claim? }` 创建对局；可原子占一个席位 |
| `POST /api/matches/:id/join` | 玩家令牌加入或重连 |
| `POST /api/matches/:id/ready` | 玩家以 `{ ready: boolean }` 准备或取消准备 |
| `POST /api/matches/:id/invitations` | 管理员为指定空席生成十分钟邀请码 |
| `POST /api/invitations/redeem` | 以邀请码、128 位兑换 ID 和玩家资料占席 |
| `GET /api/matches/:id/state` | 公共或玩家视角状态 |
| `GET /api/matches/:id/setup` | 管理员恢复席位令牌与 MCP 配置的临时兼容接口 |
| `POST /api/matches/:id/actions` | 提交 `expectedVersion + action` |
| `GET /api/matches/:id/events` | 公共 SSE 快照 |
| `GET /api/matches/:id/record` | 去令牌棋谱 |
| `POST /api/matches/:id/abort` | 管理员中止 |

创建请求示例：

```json
{
  "config": { "maxPlies": 300, "turnTimeoutMs": null, "firstPlayer": "left" },
  "claim": {
    "seat": "left",
    "profile": { "displayName": "浏览器玩家", "clientType": "browser" }
  }
}
```

不传 `claim` 时只返回管理员凭据；传入 `claim` 时额外返回该席位的 `seat` 与 `playerToken`，不会返回另一个席位的令牌。席位公开阶段为 `open`、`claimed` 或 `ready`。邀请码使用 128 位随机值，服务端只持久化 SHA-256 摘要；兑换请求的 `redemptionId` 是客户端生成的 32 位十六进制字符串。同一兑换 ID 可安全重试并取得同一席位凭据，其他兑换 ID 会收到 `INVITE_CONSUMED`。

## MCP agent

推荐启动不预绑定的 MCP 进程，由 Agent 使用短期邀请码加入：

```json
{
  "mcpServers": {
    "ball-chess": {
      "command": "node",
      "args": ["E:\\My_project\\ball_chess\\mcp\\index.js", "--url", "http://127.0.0.1:7100"]
    }
  }
}
```

通用进程提供 `join_by_invite`、`set_ready`、`get_match_state`、`get_match_record`、`wait_for_turn` 和 `submit_action`。`join_by_invite` 在宿主内部生成幂等兑换 ID，认领后通过 `/ready` 自动准备；工具参数和结果都没有玩家 token。`wait_for_turn` 通过 SSE 跨心跳和临时断线持续等待，只在轮到自己、终局或调用取消时返回。

下面的预绑定形式仅用于测试、自动化和兼容恢复：

```json
{
  "mcpServers": {
    "ball-chess": {
      "command": "node",
      "args": [
        "E:\\My_project\\ball_chess\\mcp\\index.js",
        "--url",
        "http://127.0.0.1:7100",
        "--match",
        "MATCH_ID"
      ],
      "env": {
        "BALL_CHESS_PLAYER_TOKEN": "PLAYER_TOKEN"
      }
    }
  }
}
```

每个 agent 使用独立的 stdio 进程和独立席位令牌。配置不含管理员令牌，但包含所选席位令牌，因此必须按凭据保管。带 `--match` 启动时，适配器从 `BALL_CHESS_PLAYER_TOKEN` 取得令牌，在第一个状态、等待或行动调用前幂等加入；子进程重启后会以同一配置重新绑定。一个 MCP 进程只能绑定一个对局席位。

预绑定进程隐藏 `join_by_invite`，向 Agent 提供五个工具：

- `set_ready`：占席后发送或取消 ready；双方都发送 `ready: true` 后开始。
- `get_match_state`：获取 JSON 状态、带坐标 ASCII 棋盘和当前决策包。
- `get_match_record`：按需获取本局配置、完整行动序列和结果；不会把整局棋谱重复放进每个回合状态。
- `wait_for_turn`：通过 SSE 等待自己回合或终局；心跳和短暂重连不会制造一次新的模型轮次。
- `submit_action`：携带最新 `expectedVersion` 和从 `decision.legal` 原样复制的 `actionId`；遇到 `STALE_STATE` 或 `ILLEGAL_ACTION` 时读取返回状态后重新选择。

MCP 与 DSH 直接复用 `agent/` 下同一个协议客户端。结构化状态在 `legalActionList` 中保留 HTTP 返回的完整行动数组，并通过 `legalActions.moves`、按 `h`/`v` 分组的墙锚点和可无损还原的墙范围提供兼容视图。`decision` 额外提供 `you/opponent` 视角别名、移动目标格、合法行动 ID、坐标轴以及横墙和竖墙实际阻断的两条格边；绝对坐标不会因席位旋转。行动 ID 为 `move:up|down|left|right` 或 `wall:h|v:<x>:<y>`，只用于模型工具层，HTTP 程序 bot 仍提交原结构化 action。模型文本还包含本局规则、墙配额、双方墙使用情况、版本、截止时间和终局原因；有限墙与无限墙均从实际对局配置派生，不采用固定数量。

该决策包只降低读取和提交歧义，不提供最短路径、局面评分、胜率、搜索树或推荐行动。完整棋谱中的每一步同时保存结构化 action 和相同的规范化 `actionId`，可从本局配置确定性重放。

平台不会自动启动 Kimi、Claude、Codex 或其他第三方 agent，也不保存模型 API 密钥。自动测试验证了标准 MCP 与两个独立 stdio 测试客户端，不声称已逐一验证所有第三方厂商。

## DSH Agent 预设

项目根 `package.json` 把 `dsh/ball-chess.overlay.yml` 声明为本地 DSH bundle，其中增加 **Ball Chess player** 预设。它只装配 Ball Chess 工具、专用 persona 和 Ball Chess 压缩服务，不装配 shell、文件系统、浏览器、Web、工作流或 subagent 工具。先启动游戏服务，再把当前 checkout 安装到 Web profile：

```powershell
$env:BALL_CHESS_URL = 'http://127.0.0.1:7100'
pnpm.cmd --dir E:\Program\deepseek-harness dsh plugin --profile web add E:\My_project\ball_chess
pnpm.cmd --dir E:\Program\deepseek-harness dsh web
```

新建对话时选择该预设，输入“加入邀请码 … 并开始”。每个 DSH Agent ID 对应独立 credentials 记录；同一会话可在重启后由用户输入“继续对局”恢复，fork/subagent 不继承席位，等待取消保留绑定。观察到终局后，插件把含 token 的绑定原子替换为不含秘密的终局回执，因此模型尚未报告结果时即使进程中断也能恢复。

专用压缩服务继承 DSH `BasicCompactionEngine` 的自动压力、手动 `/compact`、模型切换保护和上下文溢出恢复，只替换摘要策略。默认摘要上限为 4,096 token，这不是正常对局模型的最大输出设置。详细安装、配置与生命周期说明见 [`dsh/README.md`](dsh/README.md)。

## 持久化与安全边界

- 真实对局写入 `data/matches/<matchId>.json`，采用临时文件加原子替换；测试只使用已忽略的 `.tmp/`。
- 持久化文件包含私密令牌，**不要分享该目录**。`GET /record` 导出的棋谱会移除玩家和管理员令牌。
- 预绑定 MCP 配置包含一个席位令牌；不要把该配置粘贴到模型消息、会话记录或公共日志中。邀请优先的 MCP 与 DSH 流程不会把长期 token 放入工具参数或模型文本。
- 回合计时按持久化截止时间恢复。载入时会校验记录字段并重放全部行动；字段、版本、状态、截止时间或结果互相矛盾的记录会被隔离且不会自动覆盖。
- 新建和后续写入使用持久化记录 v2：保存席位阶段、`startedAt` 和邀请码消费回执，不保存可推导的对局状态。合法 v1 记录会先严格校验和重放，再在内存迁移；仅加载不会改写原文件，下一次权威变更才写成 v2。
- 默认仅绑定本机回环地址，不开放 CORS，也不承诺公网部署安全。显式修改监听地址不等于完成公网加固。

## 验证

```bash
npm.cmd test
node --check server/index.js
node --check mcp/index.js
node --check web/app.js
```

测试覆盖规则、墙体与路径、全部终局、并发版本、原子存储、恢复、HTTP/SSE、双 bot 对战、双 MCP stdio 客户端、双 DSH Session、凭证恢复/隔离/清理，以及 SVG 几何、浏览器状态机和真实浏览器主流程。
