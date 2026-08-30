---
name: cnb-npc
description: >
  让 CNB（cnb.cool）的 CodeBuddy NPC 替你完成开发任务（"替我上班"），也支持只读评审。
  一键完成：首次引导注册/生成访问令牌 → 自动建组织/建仓库 → 推送代码 →
  开 Issue（@CodeBuddy）→ 轮询进度 → 汇报结果（工作模式收 PR，只读模式收评论报告）。
  触发场景：用户说"让 NPC 帮我干活"、"帮我派发给 CodeBuddy"、"替我上班"、
  "把任务扔给 CodeBuddy NPC"、"让 NPC 评审这段代码"，或要求把本地代码交给云端 AI 完成开发或评审。
---

# cnb-npc：把任务派发给 CNB CodeBuddy NPC

## 两种模式

| 模式 | 用法 | NPC 行为 | 产出 | 轮询目标 |
|---|---|---|---|---|
| 工作模式（默认） | `run "<任务>"` | 写代码、建分支、提 PR | PR | NPC 的 PR |
| 只读模式 | `run "<任务>" --no-work-mode` | 只读分析，不改代码 | 评论里的报告 | NPC 的评论 |

两种模式的建组织/仓库、推送、开 Issue 编排完全一致，区别只在 Issue 是否带 `work_mode` 字段以及轮询目标。

## 适用场景

- 用户有一个开发任务，希望交给 CNB 平台的 CodeBuddy NPC 在云端自动完成（理解需求 → 读代码 → 写代码 → 提 PR）。
- 用户想让 NPC 做**只读评审/分析**（代码评审、方案建议、批量排查），不要它改代码。
- 用户想把本地某个目录的代码推送到 CNB 仓库，让 NPC 在仓库上下文中干活。
- 用户刚接触 CNB，需要引导注册 + 生成访问令牌。

## 前提

- 本机已安装 Node.js（≥18，内置 fetch）和 git。
- 首次使用需要 CNB 账号 + 访问令牌（脚本会引导，全程只需人工做两件事：注册、粘贴令牌）。

## 使用步骤

### 1. 首次引导（仅一次）

```bash
node cnb-npc-skill/bin/cnb-npc.js onboard
```

脚本会：
1. 检测是否已有 Token（环境变量 `CNB_TOKEN` 或 `~/.cnb-npc/config.json`）——有则跳过；
2. 打开浏览器跳转 cnb.cool 注册页 和 cnb.cool/profile/token 令牌页；
3. 提示用户勾选授权范围（建议全选最省事）：`group-manage:rw`（建组织）、`group-resource:rw`（建仓库）、`repo-issue:rw`（开 Issue + 工作模式）、`repo-pr:rw`（轮询/合并 PR）、`repo-code:rw`（推送/查分支）、`repo-basic-info:r`、`repo-notes:rw`（读 NPC 报告 + 发评论重触发）、`account-engage:r`（列组织）；
4. 用户粘贴令牌 → 脚本用 `GET /user/groups` 校验 → 存入 `~/.cnb-npc/config.json`。

非交互环境（CI/无 TTY）下若没有 Token，脚本会直接报错并给出手动步骤，不会挂起等待输入。

### 2. 派发开发任务（工作模式，默认）

```bash
node cnb-npc-skill/bin/cnb-npc.js run "给 README 补一份 API 使用示例" --dir ./my-code
```

编排流程（全部自动）：
1. **组织**：`--org` 指定；否则用已有的第一个组织；都没有则自动创建 `npc-workspace`；
2. **仓库**：`--repo` 指定（默认 `npc-task`）；不存在则自动创建（默认 `private`）；
3. **推送**：`--dir` 指定本地代码目录；未指定则生成一个含任务说明 README 的临时仓库。git 推送使用 `cnb` 用户 + 令牌密码，推送后 remote 会换回不带令牌的干净地址；
4. **开 Issue**：`@CodeBuddy` 写在 Issue 正文**纯文本**中（不能在代码块/引用/列表里，否则不触发），并带 `work_mode: true` 开启工作模式（NPC 可写代码、建分支、提 PR）；
5. **轮询**：每 `--interval` 秒（默认 30）查一次 NPC 的 PR（优先 npc-observability 专用接口，`author.is_npc` 兜底），直到 `--timeout`（默认 3600s）；期间 NPC 评论有新增时会提示"已在发言，尚未提 PR"；
6. **汇报**：发现 NPC 的 PR 后打印链接；加 `--merge` 自动 squash 合并。

### 3. 派发只读任务（评审/分析，不写代码）

```bash
node cnb-npc-skill/bin/cnb-npc.js run "评审最近 10 个提交的异常处理是否健全" --dir ./my-code --no-work-mode --title "代码评审：异常处理"
```

- `--no-work-mode`：创建的 Issue **不带 `work_mode` 字段**，NPC 只在评论里输出报告，不会写代码/提 PR；
- `--title`：自定义 Issue 标题（默认取任务描述前 255 字符）；
- `--body-file <路径>`：用文件内容作为整个 Issue 正文（UTF-8），适合复杂评审指令；文件里必须包含**纯文本** `@CodeBuddy`；
- `--no-push`：跳过推送，评审远端仓库已有内容时用（要求仓库已存在）；
- 轮询目标自动切换为**评论**：NPC 回复后直接把报告打印出来。

**指定模型**：把 `@npc/CodeBuddy(模型名)` 写在正文开头即可切换模型（实测有效；可用模型以官方 [npc/CodeBuddy](https://cnb.cool/npc/CodeBuddy) 仓库为准）：

```
@npc/CodeBuddy(模型名) 请对 master 分支最近 N 个提交做只读评审，不要修改代码。
```

复杂正文建议写入文件后用 `--body-file` 传入。

### 4. 收报告与多轮追问

```bash
# 查看某 Issue 的全部评论
node cnb-npc-skill/bin/cnb-npc.js comments owner/repo 12

# 等待新评论出现并打印（收只读报告；超时退出码 2）
node cnb-npc-skill/bin/cnb-npc.js comments owner/repo 12 --wait --timeout 600

# 发评论：@CodeBuddy 重新触发 NPC / 多轮追问
node cnb-npc-skill/bin/cnb-npc.js comment owner/repo 12 "@CodeBuddy 请针对第 3 条问题给出修复方案（只读，不要改代码）"
```

### 5. 通用 OpenAPI 透传（api）

lib 未逐个封装的接口（改标题、删 Issue、列分支等）都走通用透传：

```bash
# 修改 Issue 标题
node cnb-npc-skill/bin/cnb-npc.js api PATCH owner/repo/-/issues/12 --data '{"title":"新标题"}'

# 请求体放文件里（含中文时推荐，避免 shell 转义问题）
node cnb-npc-skill/bin/cnb-npc.js api POST owner/repo/-/issues/12/comments --data @comment.json
```

注意：Git Bash 会把 `/xxx` 参数转换成本地路径，请用 `MSYS_NO_PATHCONV=1` 前缀或在 PowerShell/cmd 中运行（命令自身检测到盘符路径时也会提示）。

### 6. 常用选项

| 选项 | 说明 | 默认 |
|---|---|---|
| `--org <slug>` | 组织路径 | 已有第一个 / npc-workspace |
| `--repo <name>` | 仓库名 | npc-task |
| `--dir <路径>` | 本地代码目录 | 临时 README 仓库 |
| `--visibility` | public / private / secret | private |
| `--no-work-mode` | 只读模式：NPC 只在评论输出报告 | 关（默认工作模式） |
| `--title <文本>` | 自定义 Issue 标题 | 任务描述前 255 字符 |
| `--body-file <路径>` | 用文件内容作 Issue 正文 | 关 |
| `--no-push` | 跳过推送（评审已有远端仓库） | 关 |
| `--timeout <秒>` | 轮询超时 | 3600 |
| `--interval <秒>` | 轮询间隔 | 30 |
| `--merge` | 检测到 PR 自动 squash 合并 | 关 |
| `--no-browser` | onboard 时不自动开浏览器 | 关（默认自动打开） |

### 7. 状态查看

```bash
node cnb-npc-skill/bin/cnb-npc.js status
```

## 关键约束（写 Issue 时的纪律）

- `@CodeBuddy` 必须出现在 Issue 正文的**纯文本**位置（代码块 / 引用 / 列表 / 表格里的 @ 不触发 NPC）。
- **编辑 Issue 描述、重开 Issue 不会重新触发** NPC；只有新建的 Issue 或新评论里的 @ 才会触发。
- Issue 评论数超过 100 条后不再触发任何 @npc 事件。
- NPC 在 Issue 所属仓库的**默认分支**上执行，所以推送时要确保代码在默认分支（脚本会自动查询 `GET /{repo}/-/git/head` 的分支名）。

## 安全注意事项

- 令牌只存环境变量或 `~/.cnb-npc/config.json`，**绝不写入 Issue 正文**（仓库可能公开）。
- git 推送用带令牌的 URL 一次性完成，随后 remote 换回干净地址，避免令牌留在 `.git/config`。
- 仓库默认 `private`；如需公开用 `--visibility public`。
- NPC 侧的 `CNB_TOKEN` 由平台限制在单仓库内，无需额外处理。

## 故障排查

- **401**：令牌无效/过期，重新 `onboard` 或换 `CNB_TOKEN`。
- **创建组织失败**：`npc-workspace` 可能已被占用，改用 `--org 你的组织`。
- **NPC 没反应**：按顺序检查——① Issue 正文里 `@CodeBuddy` 是否为纯文本；② 只读任务**没有 PR 是正常的**，产出在评论里；③ 观察 Issue 的评论数/更新时间是否在推进：评论在涨说明 NPC 在干活，长时间不涨才需要发新评论重新 @ 触发（`comment` 命令即可）。
- **轮询超时**：NPC 执行是分钟~小时级，可加大 `--timeout`；或用 `comments <owner/repo> <n> --wait` 只盯评论；或直接访问 Issue 页面看进度。
