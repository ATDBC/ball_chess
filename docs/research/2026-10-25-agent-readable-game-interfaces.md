# 面向 Agent 的棋类游戏接口研究

日期：2026-10-25

## 结论先行

成熟棋类接口的共同点不是“把棋盘画得更漂亮”，而是把四种数据分开：当前可观察状态、合法行动、完整历史、终局结果。对 Ball Chess，最合适的方向是保留结构化 JSON 作为权威接口，同时提供简短、可逆、坐标含义明确的人类可读记法；不要向 Agent 提供最佳行动、行动评分、搜索树或最短路径建议。

## 关键证据

1. **当前状态不等于棋谱。** python-chess 的 `Board.fen()` 编码当前局面（棋盘、行棋方、王车易位权、吃过路兵格、半回合钟、回合数），而 PGN API 用 `mainline_moves()` 表示并回放完整着法序列。这种分离避免每次决策都携带整局历史，同时仍能按需审计和复盘。[python-chess Core](https://python-chess.readthedocs.io/en/latest/core.html#chess.Board.fen)；[python-chess PGN](https://python-chess.readthedocs.io/en/latest/pgn.html)

2. **合法行动应是一等数据，而不是让 Agent 从规则中猜。** python-chess 直接暴露 `Board.legal_moves`，并提供可校验的 UCI/SAN 解析；PettingZoo Chess 把合法性作为 `action_mask` 放进 observation，且非当前行动方的 mask 全为零。[python-chess Core](https://python-chess.readthedocs.io/en/latest/core.html#chess.Board.legal_moves)；[PettingZoo Chess](https://pettingzoo.farama.org/main/environments/classic/chess/#legal-actions-mask)

3. **轮到谁、是否结束、为何结束不能靠间接推断。** PettingZoo AEC 的标准循环每步返回 `observation, reward, termination, truncation, info`，终止后传入 `None`；OpenSpiel 的 RL `TimeStep` 明确包含 `current_player`、逐玩家 `legal_actions` 和 `FIRST/MID/LAST`，终局时返回 rewards 并将 discount 置零。[PettingZoo AEC](https://pettingzoo.farama.org/main/api/aec/)；[OpenSpiel RL environment](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/rl_environment.py#L236-L281)

4. **Agent 观察与调试用完整状态应分层。** OpenSpiel 将 observation 定义为玩家在该时刻可见的信息；完整观察—行动历史应足以重建 information state。其 RL 包装器默认给策略 observation/information state，只有 `include_full_state` 打开时才附带序列化完整状态，并明确称其主要用于调试。[OpenSpiel `spiel.h`](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/spiel.h#L611-L646)；[OpenSpiel RL environment](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/rl_environment.py#L144-L168)

5. **机器 ID 与人类记法可以并存且可逆。** OpenSpiel 同时定义整数 action、`ActionToString` 和反向 `StringToAction`；它还同时提供 legal action 列表和固定长度 mask。其接口说明字符串可以依赖当前局面，例如棋谱式 `Nf3`。[OpenSpiel `spiel.h`](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/spiel.h#L320-L375)

6. **历史至少要保留行动者与行动。** OpenSpiel 的 `FullHistory()` 保存 `(player, action)` 对，`HistoryString()` 提供文本投影，并要求历史序列与状态可一一对应；这比只有“最后一步”更适合重放、争议审计和赛后分析。[OpenSpiel `spiel.h`](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/spiel.h#L496-L523)

7. **Quoridor 的坐标记法可以很短，但方向必须显式。** OpenSpiel 的 Quoridor 实现把格子写成 `a1`，墙在锚点后加 `v` 或 `h`；终端棋盘同时打印横纵坐标。它用相对行动 ID 表示棋子方向移动，用绝对锚点表示墙，并在合法行动生成时验证每名玩家仍有通路。[Quoridor source](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/games/quoridor/quoridor.cc#L127-L138)；[action encoding](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/games/quoridor/quoridor.cc#L198-L265)；[wall legality](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/games/quoridor/quoridor.cc#L310-L346)

8. **Quoridor 实现本身也是一个反例提醒。** OpenSpiel 将 Quoridor 标为确定性、完全信息游戏，但当前游戏清单同时标记为存在已知问题；因此可以借鉴其接口拆分和记法，不能未经 Ball Chess 自身端到端验收就照搬规则实现。[OpenSpiel game list](https://github.com/google-deepmind/open_spiel/blob/master/docs/games.md)

## 接口比较

| 系统 | 当前状态/观察 | 合法行动 | 行动表示 | 历史 | 终局 | 坐标与视角 |
| --- | --- | --- | --- | --- | --- | --- |
| python-chess | FEN/`Board` 表示当前局面 | `legal_moves` | UCI 适合机器，SAN 适合人类 | `move_stack`；PGN 主线/变例 | `Outcome` 含 winner 与 termination reason | 标准棋格坐标，记法约定成熟 |
| PettingZoo AEC | 每名 Agent 的 observation | observation 中的 mask；只为当前行动方非零 | 固定离散 action ID | 环境可通过 observation 堆叠历史，但 AEC 不要求把完整棋谱塞进单步 observation | termination 与 truncation 分开，reward 单列 | Chess 文档明确白方固定视角及黑方观察转换；视角必须写进接口 |
| OpenSpiel | observation、information state、serialized full state 分层 | action 列表或固定长度 mask | ID、字符串、结构体均可；字符串可逆 | `History` / `FullHistory` / `HistoryString` | `IsTerminal`、`Rewards`、`Returns` | 完全信息游戏通常可用玩家无关观察，也允许 egocentric 投影 |
| OpenSpiel Quoridor | 可读棋盘 + observation tensor | 枚举棋子移动与合法墙位 | `a1`、`a1h`、`a1v`；棋子 action 为相对方向，墙为绝对锚点 | information state 直接采用 history string | winner/draw 投影为逐玩家 returns | 棋盘边缘重复打印坐标；`h/v` 仍需规则说明其实际阻断边 |

## 对 Ball Chess 的建议

### 1. 定义一个“决策观察”，不要让 Agent 拼装事实

`get_match_state` 应一次返回：

- `matchId`、`stateVersion`、`status`、`currentPlayer`；
- 棋盘尺寸、双方位置、双方目标边、各自剩余墙数；
- 已放置的墙，使用结构化 `{x, y, orientation}`；
- `lastAction`；
- 当前行动方的合法行动；
- 终局时的 `winner`、`result`、`reason`。

这是“可观察事实”，不是策略分析。每次提交行动继续携带 `expectedVersion`，让过期观察显式失败，并在冲突错误里返回最新版本号。

### 2. 同时提供结构化行动与可逆短记法

结构化 JSON 继续作为提交接口；额外给每个合法行动一个稳定文本，例如 `P:e4`、`W:d3h`、`W:d3v`。解析器必须满足“格式化后可解析回同一行动”。不要只给整数 ID，也不要只给自然语言描述。

短记法必须随规则元数据明确说明：原点在哪里、x/y 或列/行如何增长、玩家目标方向、墙锚点是哪一个交叉点、`h` 和 `v` 分别阻断哪两条相邻边。墙的初始数量应来自本局配置，不写死在提示词中。

### 3. 为 LLM 返回“合法行动清单”，mask 只作为可选机器投影

固定动作空间的神经网络适合二进制 mask；LLM 更容易读取按类别分组的合法行动：

```json
{
  "pawnMoves": [{"notation": "P:e4", "to": {"x": 4, "y": 3}}],
  "wallPlacements": [{"notation": "W:d3v", "x": 3, "y": 2, "orientation": "vertical"}]
}
```

若合法墙位很多，可以在文本投影中按连续范围压缩，但结构化结果必须仍能无损列出或分页获取；否则 Agent 仍需猜测范围展开规则。

### 4. 完整棋谱做成独立、按需读取的资源

增加 `get_match_record`（或等价资源），返回本局配置、参与席位、带序号的 `(player, action, resultingVersion)`、终局结果。`get_match_state` 只带最近一步和当前观察，避免每回合重复传输越来越长的棋谱。棋谱应足以从初始配置确定性重放，但不包含 Agent 私有思考过程。

### 5. 规则说明与状态接口使用同一坐标词汇

规则工具或首次加入响应应给出两个最小示例：一个棋子移动、一个横墙和竖墙，并逐条列出墙阻断的边。ASCII 棋盘可以保留为辅助视图，但不能成为坐标语义的唯一来源；二维字符画在旋转、字体和空格压缩后容易产生歧义。

### 6. 不把策略计算伪装成“可读性”

默认不向 Agent 暴露：推荐行动、每步评分、胜率、搜索树、威胁排序、双方最短路径或“关键墙位”。OpenSpiel Quoridor 的最短路径搜索用于判定墙是否合法，并未作为 observation 输出，这条分界很适合 Ball Chess。若以后为了特定赛制公开派生指标，应对双方完全对称、写入观察版本，并明确这会改变任务难度。

### 7. 公平评测采用成对换边，而不是假设规则绝对对称

这是基于上述接口事实作出的评测建议：同一模型组合、同一规则配置至少进行两局，交换先后手与颜色；若存在任何随机性，复用相同 seed。报告总胜率时同时报告按席位拆分的胜率、非法行动率、工具失败率和平均回合数。不要通过给某一方旋转后的额外提示或不同字段来“修正”先手优势；双方应收到语义等价的观察。

## 推荐的最小落地顺序

1. 先固定并测试坐标/墙方向语义，以及人类可读记法的双向转换。
2. 补齐 `get_match_state` 的显式 actor、version、terminal/result/reason 和分组合法行动。
3. 增加独立 `get_match_record`，做从记录重放到相同终局的端到端测试。
4. 做换边对局验收：同一对 Agent 连续完成两局，验证观察字段对称、历史完整、终局一致。

这四步已经足够解决“Agent 看不懂局面”和“赛后无法直接获得完整棋谱”两类问题，不需要先引入通用博弈框架、策略引擎或新的分析服务。
