# Ball Chess

本地运行的 9 × 13 双人放墙竞速游戏。浏览器使用原生 HTML/CSS/JavaScript/SVG，无前端依赖、无需构建；Node 服务统一负责规则、持久化、HTTP、SSE 与 MCP 接入。

## 规则速览

- 左下为 `(0, 0)`；左侧红球从 `(2, 0)`、右侧蓝球从 `(6, 0)` 出发，先到顶行 `y = 12` 的任意格获胜。
- 双方轮流行动，每次四向移动一格，或放置一块墙；不能斜走、跳跃、进入对方所在格或主动跳过。
- 横墙与竖墙都覆盖两条单位格边。墙不可重叠或十字交叉，允许首尾相连和合法 T 形连接；放墙后双方都必须保留到顶边的路径。
- 默认无限墙（`wallLimit = null`），可配置每方有限墙。默认最多 300 手（`maxPlies = 300`）；先判断顶边胜利，再判断行动上限和棋。
- 默认左侧先手，可配置右侧或随机。轮到一方时若完全无合法行动，该方判负。
- 默认不限回合时间；配置 `turnTimeoutMs` 后，超时方判负。管理员也可中止对局。
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

1. 在“新建对局”中选择自己的席位，或选择“仅观战”；设置墙体、行动上限、回合超时和先手后创建。
2. 创建者页面会显示每个席位的独立 MCP 配置与提示词。席位令牌只进入对应配置的子进程环境，不进入提示词；不要把管理员令牌当作玩家令牌使用。
3. 另一名玩家在“加入或观战”中输入对局 ID 和自己的玩家令牌；只输入对局 ID、留空令牌即可观战。
4. 轮到你时选择“移动一球”或“放置挡板”。放墙模式可切换横/竖方向；等待对方和观战时操作锁定。
5. 页面通过 SSE 接收权威快照，断线后会自动重连并重新拉取状态。服务重启后可根据持久化记录恢复。

创建者浏览器保存对局 ID 与管理员令牌以恢复管理界面；直接加入者只保存自己的席位令牌。它们位于当前源的 `localStorage["ballChess.activeMatch"]`，请勿在不受信任的浏览器或共享账户中保留。

## 程序 bot

先通过页面或 `POST /api/matches` 创建对局并取得对局 ID 与两个玩家令牌，然后为每个席位运行独立客户端。以下示例适用于 Git Bash：

```bash
node examples/bot.js --url http://127.0.0.1:7100 --match "$MATCH_ID" --token "$LEFT_TOKEN" --strategy greedy
node examples/bot.js --url http://127.0.0.1:7100 --match "$MATCH_ID" --token "$RIGHT_TOKEN" --strategy random --seed 2
```

可选参数：`--strategy greedy|random`、`--seed <整数>`、`--poll-ms <毫秒>`。bot 只使用服务端返回的 `legalActions`，不自行复制墙体或路径规则。

主要 HTTP 接口：

| 方法与路径 | 用途 |
|---|---|
| `POST /api/matches` | 创建对局 |
| `POST /api/matches/:id/join` | 玩家令牌加入或重连 |
| `GET /api/matches/:id/state` | 公共或玩家视角状态 |
| `GET /api/matches/:id/setup` | 管理员恢复席位令牌与 MCP 配置 |
| `POST /api/matches/:id/actions` | 提交 `expectedVersion + action` |
| `GET /api/matches/:id/events` | 公共 SSE 快照 |
| `GET /api/matches/:id/record` | 去令牌棋谱 |
| `POST /api/matches/:id/abort` | 管理员中止 |

## MCP agent

创建者从页面复制 MCP 配置，或按实际安装路径使用如下结构：

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

预绑定进程向 agent 提供三个工具：

- `get_match_state`：获取 JSON 状态、ASCII 棋盘与合法行动。
- `wait_for_turn`：通过 SSE 等待自己回合或终局；单次等待最多 15 秒，等待超时不代表输棋。
- `submit_action`：携带最新 `expectedVersion` 提交一个 `legalActions` 中的行动；遇到 `STALE_STATE` 或 `ILLEGAL_ACTION` 时读取返回状态后重新选择。

不带 `--match` 的通用 MCP 进程还提供 `join_match`，供需要在工具调用中手动绑定的客户端使用。MCP 状态把 HTTP 的完整行动对象压缩为 `legalActions.moves` 和按 `h`、`v` 分组的 `legalActions.walls` 锚点；提交时仍使用标准 `move` 或 `place_wall` 行动对象。

平台不会自动启动 Kimi、Claude、Codex 或其他第三方 agent，也不保存模型 API 密钥。自动测试验证了标准 MCP 与两个独立 stdio 测试客户端，不声称已逐一验证所有第三方厂商。

## 持久化与安全边界

- 真实对局写入 `data/matches/<matchId>.json`，采用临时文件加原子替换；测试只使用已忽略的 `.tmp/`。
- 持久化文件包含私密令牌，**不要分享该目录**。`GET /record` 导出的棋谱会移除玩家和管理员令牌。
- 页面生成的预绑定 MCP 配置包含一个席位令牌；不要把该配置粘贴到模型消息、会话记录或公共日志中。
- 回合计时按持久化截止时间恢复；损坏记录会隔离，不会自动覆盖。
- 默认仅绑定本机回环地址，不开放 CORS，也不承诺公网部署安全。显式修改监听地址不等于完成公网加固。

## 验证

```bash
npm.cmd test
node --check server/index.js
node --check mcp/index.js
node --check web/app.js
```

测试覆盖规则、墙体与路径、全部终局、并发版本、原子存储、恢复、HTTP/SSE、双 bot 对战、双 MCP stdio 客户端，以及 SVG 几何和浏览器纯模块。
