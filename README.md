<div align="center">

# cnb-npc-skill

**让 CNB 的 CodeBuddy NPC 替自己上班** — 一句话派发任务，云端 AI 在仓库里自主完成开发并提交 PR，你只需验收。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Platform: Windows / macOS / Linux](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg)](README.md)
[![CI](https://img.shields.io/badge/CI-node--check-passing-brightgreen.svg)](.github/workflows/ci.yml)
<!-- TODO(发布前): 替换下方两个 badge 为真实仓库链接 -->
[![GitHub stars](https://img.shields.io/badge/stars-0-lightgrey.svg)](#)
[![GitHub issues](https://img.shields.io/badge/issues-0-lightgrey.svg)](#)

*零依赖 · 纯 Node.js · OpenAPI 驱动*

</div>

---

## 📖 简介

[CNB](https://cnb.cool) 平台的 **CodeBuddy NPC** 是一个运行在云端的 AI 智能体（"我的 AI 员工"）：你在仓库的 Issue 里 `@CodeBuddy` 并开启工作模式，它就能自主完成 **需求理解 → 读代码 → 建分支 → 写代码 → 提 PR** 的完整闭环。

但手动操作太繁琐：注册 → 建仓库 → 推送代码 → 开 Issue → 等结果 → 反复刷新页面。**cnb-npc-skill** 把这一切封装成一条命令 / 一个可被 AI 助手显式调用的技能：

```bash
node bin/cnb-npc.js run "写一个 Python 脚本 hello.py，输出 Hello, CodeBuddy NPC!"
```

全链路自动完成：建组织/建仓库 → 推送代码 → 开 Issue（`@CodeBuddy` + 工作模式）→ 轮询 NPC 进度 → 汇报 PR 链接，可选自动合并。

## ✨ 特性

- **一键端到端**：从 Token 引导到 PR 验收，全程自动化，人工步骤只剩"注册账号 + 粘贴令牌"两次
- **首次引导**：自动检测 Token，跳转浏览器完成注册/生成令牌，粘贴即校验并持久化
- **自动建组织/仓库**：`group-manage` / `group-resource` API 支持，无组织也能开跑
- **工作模式 API 直开**：创建 Issue 时传 `work_mode: true`，无需网页勾选"替我上班"
- **智能轮询**：监听 NPC 提交的 PR（`author.is_npc`），支持超时控制与自动 squash 合并
- **零依赖**：仅需 Node.js ≥ 18（内置 fetch）与 git，无任何第三方包
- **可被 AI 助手调用**：内置 `SKILL.md`，可安装到 AtomCode / CodeBuddy 等助手的 skills 目录，说一句"让 NPC 替我上班"即可触发
- **令牌安全**：Token 只存环境变量或 `~/.cnb-npc/config.json`，绝不写入 Issue 正文，git remote 推送后自动清理令牌

## 🚀 快速开始

### 前置要求

| 依赖 | 版本 |
|---|---|
| [Node.js](https://nodejs.org) | ≥ 18（内置 `fetch`） |
| [git](https://git-scm.com) | 任意现代版本 |
| [CNB 账号](https://cnb.cool) | 免费注册 |

### 1. 安装

```bash
git clone https://github.com/<你的用户名>/cnb-npc-skill.git
cd cnb-npc-skill
# 无需 npm install —— 零依赖
```

### 2. 首次引导（仅一次）

```bash
node bin/cnb-npc.js onboard
```

脚本会：检测已有 Token → 打开浏览器跳转注册页与令牌页 → 提示勾选授权范围 → 粘贴令牌 → 校验并保存到 `~/.cnb-npc/config.json`。

建议勾选的授权范围：

| 权限 | 范围 | 用途 |
|---|---|---|
| `group-resource` | 读写 | 自动建仓库 |
| `repo-issue` | 读写 | 开 Issue + `work_mode` 工作模式 |
| `repo-pr` | 读写 | 轮询 PR + 自动合并 |
| `repo-code` | 读写 | git 推送 + 查默认分支 |
| `repo-basic-info` | 只读 | 仓库存在性判断 |
| `repo-notes` | 只读 | 读取 NPC 评论 |
| `account-engage` | 只读 | 列出组织（免去手输 `--org`） |

> 省事做法：令牌页直接全选。令牌仅保存在本机，风险可控。

### 3. 派发任务

```bash
# 从零实现（自动建组织/仓库，默认私有）
node bin/cnb-npc.js run "写一个 Rust CLI 工具，读取 CSV 输出 Markdown 表格"

# 在现有代码仓库上干活
node bin/cnb-npc.js run "给 README 补一份 API 使用示例" --dir ./my-code --org my-org --repo my-repo

# 自动合并 NPC 的 PR
node bin/cnb-npc.js run "修复登录页的 XSS 漏洞" --org my-org --repo web-app --merge
```

### 4. 查看状态

```bash
node bin/cnb-npc.js status
```

## 📚 命令参考

### 子命令

| 命令 | 说明 |
|---|---|
| `onboard` | 首次引导：注册/生成/校验/持久化访问令牌 |
| `run "<任务>"` | 端到端派发任务给 CodeBuddy NPC |
| `status` | 查看令牌来源与可访问组织 |
| `--help` | 帮助信息 |

### `run` 选项

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--org <slug>` | 组织路径 | 已有第一个组织 / `npc-workspace` |
| `--repo <name>` | 仓库名 | `npc-task` |
| `--dir <路径>` | 本地代码目录 | 临时 README 空仓库 |
| `--visibility <v>` | 仓库可见性 `public`/`private`/`secret` | `private` |
| `--timeout <秒>` | 轮询超时 | `3600` |
| `--interval <秒>` | 轮询间隔 | `30` |
| `--merge` | 检测到 PR 后自动 squash 合并 | 关 |
| `--no-browser` | onboard 时不自动打开浏览器 | 开 |

### 环境变量

| 变量 | 说明 |
|---|---|
| `CNB_TOKEN` | CNB 访问令牌（优先于本地配置文件） |

## 🧩 架构与原理

```
┌─────────────┐   ┌────────────────────────────────────────────┐
│   用户/AI    │   │              cnb-npc (Node.js)             │
│   助手对话   │──▶│  onboard → run → status                    │
└─────────────┘   │                                            │
                  │  lib/api.js ──CNB OpenAPI──▶ api.cnb.cool  │
                  │    GET/POST /groups /repos /issues /pulls  │
                  │                                            │
                  │  ① 建组织/仓库   ② git 推送代码             │
                  │  ③ 开 Issue(@CodeBuddy + work_mode)        │
                  │  ④ 轮询 NPC 的 PR   ⑤ 汇报/可选合并        │
                  └────────────────────────────────────────────┘
                                    │
                                    ▼
                  ┌────────────────────────────────────────────┐
                  │  CNB 平台：CodeBuddy NPC（云端 AI 员工）    │
                  │  理解需求 → 读代码 → 建分支 → 写代码 → PR   │
                  └────────────────────────────────────────────┘
```

### 自动化步骤与 API 映射

| 步骤 | OpenAPI 接口 | 所需权限 |
|---|---|---|
| 列组织 | `GET /user/groups` | `account-engage:r` |
| 建组织 | `POST /groups` | `group-manage:rw` |
| 建仓库 | `POST /{slug}/-/repos` | `group-resource:rw` |
| 查仓库/默认分支 | `GET /{repo}`、`GET /{repo}/-/git/head` | `repo-basic-info:r`、`repo-code:r` |
| 开 Issue（含工作模式） | `POST /{repo}/-/issues`（`work_mode: true`） | `repo-issue:rw` |
| 读评论 | `GET /{repo}/-/issues/{n}/comments` | `repo-notes:r` |
| 查 PR | `GET /{repo}/-/pulls` | `repo-pr:r` |
| 合并 PR | `PUT /{repo}/-/pulls/{n}/merge` | `repo-pr:rw` |

### 目录结构

```
cnb-npc-skill/
├── bin/
│   └── cnb-npc.js        # CLI 入口：onboard / run / status
├── lib/
│   ├── api.js            # CNB OpenAPI 客户端（零依赖，内置 fetch）
│   └── config.js         # Token 存取（环境变量优先 → ~/.cnb-npc/config.json）
├── SKILL.md              # 技能定义（可安装到 AI 助手的 skills 目录）
├── package.json          # bin 入口 + npm scripts
├── LICENSE               # MIT
└── README.md
```

## ⚠️ 注意事项

- `@CodeBuddy` 必须写在 Issue 正文的**纯文本**位置（代码块/引用/列表/表格里的 @ 不会触发 NPC）
- **编辑或重开 Issue 不会重新触发** NPC；需要再次派活请在 Issue 下发新评论 `@CodeBuddy`
- 评论数超过 100 条后不再触发任何 `@npc` 事件
- NPC 在 Issue 所属仓库的**默认分支**上执行，脚本会自动查询并推送到默认分支
- NPC 执行是分钟~小时级，属于异步任务，建议 `--timeout` 留足余量

## 🔒 安全

- 令牌只存环境变量或 `~/.cnb-npc/config.json`，**绝不写入 Issue 正文**（仓库可能公开）
- git 推送使用一次性带令牌 URL，推送后 remote 换回干净地址，避免令牌残留在 `.git/config`
- 仓库默认 `private`；需要公开时用 `--visibility public`
- NPC 侧的 `CNB_TOKEN` 由平台限制在单仓库内

## 💰 计费

当前 CNB 的 NPC 为**临时免费**阶段，收费政策以官方公告为准。用量可在 `组织 → 设置 → 用量管理` 查看（详见 [CNB 定价文档](https://docs.cnb.cool/zh/pricing.html)）。

## ❓ FAQ

**Q: 没注册过 CNB 能用吗？**
能。`onboard` 会自动跳转注册页，全程只需人工做两件事：注册账号、粘贴令牌，之后全自动。

**Q: 一定要有自己的组织吗？**
不需要。脚本默认自动创建 `npc-workspace`；你已有组织时建议用 `--org` 指定（根组织有年度创建上限）。

**Q: NPC 没反应怎么办？**
检查 Issue 正文 `@CodeBuddy` 是否为纯文本、`work_mode` 是否开启；再到 Issue 页面看是否有 NPC 评论/流水线状态。轮询超时后脚本会给出 Issue 链接，可到页面催办。

**Q: 为什么不用 GitHub Actions？**
本工具面向 CNB 平台生态（NPC 只在 CNB 仓库内执行）。它可以在本地、CI、或任意 AI 助手环境中运行。

## 🤝 贡献

欢迎提交 Issue 与 PR！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/xxx`
3. 提交改动：`git commit -m "feat: xxx"`
4. 推送分支：`git push origin feat/xxx`
5. 提交 Pull Request

开发前请运行语法检查：`npm run check`

## 📄 License

[MIT](LICENSE) © cnb-npc contributors
