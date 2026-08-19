---
name: cnb-npc
description: >
  让 CNB（cnb.cool）的 CodeBuddy NPC 替你完成开发任务（"替我上班"）。
  一键完成：首次引导注册/生成访问令牌 → 自动建组织/建仓库 → 推送代码 →
  开 Issue（@CodeBuddy + 工作模式）→ 轮询 NPC 进度 → 汇报/合并 NPC 提交的 PR。
  触发场景：用户说"让 NPC 帮我干活"、"帮我派发给 CodeBuddy"、"替我上班"、
  "把任务扔给 CodeBuddy NPC"，或要求把本地代码交给云端 AI 完成开发。
---

# cnb-npc：把任务派发给 CNB CodeBuddy NPC

## 适用场景

- 用户有一个开发任务，希望交给 CNB 平台的 CodeBuddy NPC 在云端自动完成（理解需求 → 读代码 → 写代码 → 提 PR）。
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
3. 提示用户勾选授权范围：`group-manage:rw`（建组织）、`group-resource:rw`（建仓库）、`repo-issue:rw`（Issue）；
4. 用户粘贴令牌 → 脚本用 `GET /user/groups` 校验 → 存入 `~/.cnb-npc/config.json`。

非交互环境（CI/无 TTY）下若没有 Token，脚本会直接报错并给出手动步骤，不会挂起等待输入。

### 2. 派发任务

```bash
node cnb-npc-skill/bin/cnb-npc.js run "给 README 补一份 API 使用示例" --dir ./my-code
```

编排流程（全部自动）：
1. **组织**：`--org` 指定；否则用已有的第一个组织；都没有则自动创建 `npc-workspace`；
2. **仓库**：`--repo` 指定（默认 `npc-task`）；不存在则自动创建（默认 `private`）；
3. **推送**：`--dir` 指定本地代码目录；未指定则生成一个含任务说明 README 的临时仓库。git 推送使用 `cnb` 用户 + 令牌密码，推送后 remote 会换回不带令牌的干净地址；
4. **开 Issue**：`@CodeBuddy` 写在 Issue 正文**纯文本**中（不能在代码块/引用/列表里，否则不触发），并带 `work_mode: true` 开启工作模式（NPC 可写代码、建分支、提 PR）；
5. **轮询**：每 `--interval` 秒（默认 30）查一次 NPC 的 PR（`author.is_npc` 或 npc-observability 接口），直到 `--timeout`（默认 3600s）；
6. **汇报**：发现 NPC 的 PR 后打印链接；加 `--merge` 自动 squash 合并。

### 3. 常用选项

| 选项 | 说明 | 默认 |
|---|---|---|
| `--org <slug>` | 组织路径 | 已有第一个 / npc-workspace |
| `--repo <name>` | 仓库名 | npc-task |
| `--dir <路径>` | 本地代码目录 | 临时 README 仓库 |
| `--visibility` | public / private / secret | private |
| `--timeout <秒>` | 轮询超时 | 3600 |
| `--interval <秒>` | 轮询间隔 | 30 |
| `--merge` | 检测到 PR 自动 squash 合并 | 关 |
| `--no-browser` | onboard 时不自动开浏览器 | 开 |

### 4. 状态查看

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
- **NPC 没反应**：检查 Issue 正文里 `@CodeBuddy` 是否为纯文本；确认 `work_mode` 开启；到 Issue 页面看是否有 NPC 评论/流水线状态。
- **轮询超时**：NPC 执行是分钟~小时级，可加大 `--timeout`；或直接访问 Issue 页面看进度。
