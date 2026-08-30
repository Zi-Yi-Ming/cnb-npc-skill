#!/usr/bin/env node
// cnb-npc —— 让 CNB CodeBuddy NPC 替自己上班。
// 子命令：
//   onboard          首次引导：检测 Token → 浏览器跳转 → 粘贴 → 校验 → 存配置
//   run "<任务>"     端到端编排：建组织/仓库 → 推送代码 → 开 Issue → 轮询（工作模式等 PR / 只读模式等评论）→ 汇报
//   comment          向 Issue 发评论（重触发 NPC / 多轮追问）
//   comments         查看 / 轮询 Issue 评论（只读任务的产出在评论里）
//   api              CNB OpenAPI 通用透传（lib 未封装的接口都走这里）
//   status           查看 Token / 组织状态
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { getToken, loadConfig, saveConfig, configPath } from '../lib/config.js';
import * as api from '../lib/api.js';
import { parseArgs } from '../lib/args.js';

const WEB = 'https://cnb.cool';
const HELP = `cnb-npc —— 让 CNB CodeBuddy NPC 替自己上班

用法:
  node bin/cnb-npc.js onboard                                  首次引导（注册/生成 Token）
  node bin/cnb-npc.js run "<任务描述>" [选项]                   一键派发任务（默认工作模式：NPC 写代码提 PR）
  node bin/cnb-npc.js comment <owner/repo> <issue号> "<文本>"   在 Issue 下发评论（重触发 / 多轮追问）
  node bin/cnb-npc.js comments <owner/repo> <issue号> [选项]    查看 / 轮询 Issue 评论（只读任务的产出在评论里）
  node bin/cnb-npc.js api <METHOD> <path> [选项]                CNB OpenAPI 通用透传
  node bin/cnb-npc.js status                                   查看配置状态
  node bin/cnb-npc.js --help                                   显示帮助

run 选项:
  --org <slug>         组织路径（默认：取你已有的第一个组织，没有则创建 npc-workspace）
  --repo <name>        仓库名（默认：npc-task）
  --dir <路径>         本地代码目录（默认：生成一个带任务说明的 README 空仓库）
  --visibility <v>     仓库可见性 public|private|secret（默认 private）
  --no-work-mode       只读模式：不开工作模式，NPC 只在评论里输出报告（不写代码 / 不提 PR）
  --title <文本>       自定义 Issue 标题（默认取任务描述前 255 字符）
  --body-file <路径>   用文件内容作为 Issue 正文（UTF-8，正文需包含纯文本 @CodeBuddy）
  --no-push            跳过代码推送（评审已有远端内容的仓库时用）
  --timeout <秒>       轮询超时（默认 3600）
  --interval <秒>      轮询间隔（默认 30）
  --merge              检测到 NPC 的 PR 后自动 squash 合并
  --no-browser         不自动打开浏览器（onboard 时配合手动访问）

comments 选项:
  --wait               等待新评论出现后打印出来（收 NPC 报告）
  --timeout <秒>       --wait 的超时（默认 600）
  --interval <秒>      --wait 的轮询间隔（默认 30）

api 选项:
  --data <JSON>        请求体（内联 JSON，或 @文件路径 读取 JSON 文件）

环境变量:
  CNB_TOKEN            访问令牌（优先于本地配置文件）

首次使用:
  1) node bin/cnb-npc.js onboard
  2) 按提示在浏览器完成注册并生成访问令牌（需勾选 group-manage:rw / group-resource:rw / repo-issue:rw / repo-notes:rw）
  3) 粘贴令牌回车，之后所有命令自动复用
`;

// ---------- 工具 ----------

function log(msg = '') {
  console.log(msg);
}

function fail(msg) {
  console.error(`\n[错误] ${msg}`);
  process.exit(1);
}

function isTTY() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** 跨平台打开浏览器 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawnSync(cmd, args, { stdio: 'ignore', shell: platform === 'win32' });
  } catch {
    /* 打不开也不阻塞流程 */
  }
}

/** 读取一行输入 */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/** 等待 sleep 毫秒 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在 repo 里找 NPC 创建的 PR：优先 npc-observability 专用接口，pulls 的 author.is_npc 作兜底 */
async function findNpcPrs(token, repoPath) {
  // 平台为 NPC 场景提供的专用检测接口（返回数组或 {prs:[...]}）
  try {
    const npc = await api.getNpcPrs(token, repoPath);
    const list = Array.isArray(npc) ? npc : npc && Array.isArray(npc.prs) ? npc.prs : null;
    if (list && list.length) return list;
  } catch {
    /* 接口不可用时回退到 pulls 检测 */
  }
  const out = [];
  try {
    const pulls = await api.getPulls(token, repoPath);
    for (const pr of pulls || []) {
      if (pr.author && pr.author.is_npc) out.push(pr);
    }
  } catch {
    /* 忽略，轮询继续 */
  }
  return out;
}

// ---------- onboard ----------

async function onboard({ noBrowser = false } = {}) {
  const existing = getToken();
  if (existing) {
    log(`检测到已配置的 Token（${configPath()} 或环境变量 CNB_TOKEN），无需重新引导。`);
    log('如想更换 Token：删除配置文件后重试，或直接设置环境变量 CNB_TOKEN。');
    return;
  }
  if (!isTTY()) {
    fail(
      '非交互环境下没有检测到 Token。请先手动执行 onboarding：\n' +
        `  1) 打开 ${WEB}/profile/token 生成访问令牌（勾选 group-manage:rw、group-resource:rw、repo-issue:rw、repo-notes:rw）\n` +
        `  2) 设置环境变量 CNB_TOKEN=<令牌> 后重试`
    );
  }

  log('===== CNB CodeBuddy NPC 首次引导 =====');
  log('第 1 步：注册/登录 CNB 账号（如已有账号请忽略）');
  if (!noBrowser) {
    openBrowser(WEB);
    log(`  已尝试打开 ${WEB}`);
  } else {
    log(`  请手动访问 ${WEB}`);
  }
  await prompt('按回车继续…');

  log('\n第 2 步：生成访问令牌（访问令牌页面）');
  if (!noBrowser) {
    openBrowser(`${WEB}/profile/token`);
    log(`  已尝试打开 ${WEB}/profile/token`);
  } else {
    log(`  请手动访问 ${WEB}/profile/token`);
  }
  log('  添加访问令牌时，请勾选以下授权范围（按 README 的建议全选最省事）：');
  log('    - group-manage:rw   建组织（自动创建 npc-workspace）');
  log('    - group-resource:rw 建仓库');
  log('    - repo-issue:rw     开 Issue + 工作模式');
  log('    - repo-pr:rw        轮询 PR + 自动合并');
  log('    - repo-code:rw      git 推送 + 查默认分支');
  log('    - repo-basic-info:r 仓库存在性判断');
  log('    - repo-notes:rw     读 NPC 报告 + 发评论重触发');
  log('    - account-engage:r  列出组织（免手输 --org）');

  let token = '';
  while (!token) {
    token = await prompt('\n第 3 步：请粘贴访问令牌后回车: ');
  }
  token = token.trim();

  log('\n正在校验令牌…');
  let groups = null;
  try {
    groups = await api.getUserGroups(token);
  } catch (e) {
    if (e.status === 401) {
      fail('令牌无效（401）。请确认复制完整，或重新生成令牌。');
    }
    fail(`令牌校验失败：${e.message}`);
  }

  saveConfig({ token });
  log('✅ 令牌有效，已保存到 ' + configPath());
  const groupList = (groups || []).map((g) => g.path).filter(Boolean);
  if (groupList.length) {
    log(`你的组织：${groupList.join(', ')}`);
  } else {
    log('你还没有组织，首次 run 时会自动创建 npc-workspace。');
  }
  log('\n引导完成！现在可以执行：');
  log('  node bin/cnb-npc.js run "帮我写一个 xxx"');
}

// ---------- status ----------

async function status() {
  const token = getToken();
  if (!token) {
    log('未配置 Token。请先运行： node bin/cnb-npc.js onboard');
    return;
  }
  log(`Token 来源: ${process.env.CNB_TOKEN ? '环境变量 CNB_TOKEN' : configPath()}`);
  try {
    const groups = await api.getUserGroups(token);
    const list = (groups || []).map((g) => `${g.path}（${g.name || ''}）`).join(', ') || '（无）';
    log(`可访问组织: ${list}`);
  } catch (e) {
    log(`组织查询失败: ${e.message}`);
  }
}

// ---------- run ----------

async function runTask(task, opts) {
  if (!task) fail('缺少任务描述。用法：node bin/cnb-npc.js run "<任务描述>"');
  const readOnly = Boolean(opts.noWorkMode);

  const token = getToken();
  if (!token) {
    log('未检测到 Token，先进入首次引导…\n');
    await onboard({ noBrowser: opts.noBrowser });
    if (!getToken()) fail('未获取到 Token，已中止。');
  }

  log(`\n===== 派发任务给 CodeBuddy NPC =====`);
  log(`任务: ${task}`);
  log(`模式: ${readOnly ? '只读（NPC 在评论中输出报告）' : '工作（NPC 写代码、提 PR）'}`);

  // 1. 组织：优先 --org；否则用已有的第一个；都没有则创建
  let orgSlug = opts.org;
  if (!orgSlug) {
    try {
      const groups = await api.getUserGroups(token);
      if (groups && groups.length) {
        orgSlug = groups[0].path || groups[0].name;
      }
    } catch (e) {
      log(`查询组织失败: ${e.message}`);
    }
  }
  if (!orgSlug) {
    orgSlug = 'npc-workspace';
    log(`没有可用组织，尝试创建 ${orgSlug}…`);
    try {
      await api.createGroup(token, { path: orgSlug, description: 'auto created by cnb-npc' });
    } catch (e) {
      fail(`创建组织失败：${e.message}。可改用 --org 指定已有组织。`);
    }
  }
  log(`组织: ${orgSlug}`);

  // 2. 仓库：--repo 或默认 npc-task；不存在则创建
  const repoName = opts.repo || 'npc-task';
  const repoPath = `${orgSlug}/${repoName}`;
  let repo = await api.getRepo(token, repoPath);
  const repoExisted = !!repo;
  if (!repo) {
    if (opts.noPush) {
      fail(`--no-push 需要远端仓库已存在，但 ${repoPath} 不存在。去掉 --no-push 可让脚本自动创建并推送。`);
    }
    log(`创建仓库 ${repoPath}…`);
    await api.createRepo(token, orgSlug, {
      name: repoName,
      description: `npc task: ${task.slice(0, 80)}`,
      visibility: opts.visibility || 'private',
    });
    repo = await api.getRepo(token, repoPath);
  } else {
    log(`复用已有仓库 ${repoPath}`);
    if (!opts.dir && repoExisted) {
      log(`⚠️ 未指定 --dir：将推送全新的临时目录。若远端仓库已有提交，历史分叉会导致推送失败，建议用 --dir 指定与远端同源的代码目录。`);
    }
  }

  // 3. 准备本地目录并推送（--no-push 跳过，用于评审已有远端内容的仓库）
  if (opts.noPush) {
    log('跳过推送（--no-push），直接使用远端仓库现有内容');
  } else {
    const workDir = opts.dir ? path.resolve(opts.dir) : fs.mkdtempSync(path.join(os.tmpdir(), 'cnb-npc-'));
    if (!opts.dir) {
      fs.writeFileSync(
        path.join(workDir, 'README.md'),
        `# NPC 任务\n\n${task}\n\n> 由 cnb-npc 自动创建，等待 CodeBuddy NPC 完成。\n`
      );
    }
    log(`本地目录: ${workDir}`);
    await pushToRepo(token, orgSlug, repoName, workDir);
  }

  // 4. 开 Issue：@CodeBuddy 必须在纯文本里；默认工作模式，--no-work-mode 走只读
  let body;
  if (opts.bodyFile) {
    body = fs.readFileSync(path.resolve(opts.bodyFile), 'utf8').trim();
    if (!body.includes('@CodeBuddy')) {
      log('⚠️ 正文里没有 @CodeBuddy（必须在纯文本位置），NPC 可能不会被触发。');
    }
  } else if (readOnly) {
    body = `@CodeBuddy 请完成以下只读任务：

## 任务
${task}

## 要求
- 本次为只读任务：请勿修改代码、不要创建分支、不要提交 PR
- 请直接在评论中输出完整报告
`;
  } else {
    body = `@CodeBuddy 请完成以下开发任务：

## 任务
${task}

## 要求
- 工作模式已开启，请直接编写代码、创建分支并提交 PR
- 完成后请在评论中说明实现思路和改动点
`;
  }
  log(`创建 Issue（${readOnly ? '只读模式' : '@CodeBuddy + 工作模式'}）…`);
  let issue;
  try {
    const form = { title: opts.title || task.slice(0, 255), body };
    if (!readOnly) form.work_mode = true; // 只读模式不带 work_mode 字段（与实测可用的行为一致）
    issue = await api.createIssue(token, repoPath, form);
  } catch (e) {
    fail(`创建 Issue 失败：${e.message}`);
  }
  if (!issue || issue.number === undefined) {
    fail('创建 Issue 成功但未返回编号，请到仓库页面确认后改用 comments 命令轮询。');
  }
  const issueNumber = issue.number;
  const issueUrl = `${WEB}/${repoPath}/-/issues/${issueNumber}`;
  log(`Issue #${issueNumber}: ${issueUrl}`);

  // 5. 轮询：工作模式等 NPC 的 PR；只读模式等 NPC 的评论（报告在评论里）
  const timeoutSec = Number(opts.timeout) || 3600;
  const intervalSec = Number(opts.interval) || 30;
  const deadline = Date.now() + timeoutSec * 1000;
  log(`\n开始轮询（${readOnly ? '等 NPC 评论' : '等 NPC 提交 PR'}，超时 ${timeoutSec}s，每 ${intervalSec}s 一次），Ctrl+C 可中止…`);
  const spinner = ['|', '/', '-', '\\'];
  let spin = 0;

  // Ctrl+C：保留 Issue 线索与续盯命令再退出
  process.on('SIGINT', () => {
    log(`\n\n已中止轮询。Issue 地址：${issueUrl}`);
    log(`续盯产出：node bin/cnb-npc.js comments ${repoPath} ${issueNumber} --wait`);
    process.exit(130);
  });

  let knownComments = null; // 只读模式的评论基线
  let seenComments = 0; // 工作模式的进度提示
  while (Date.now() < deadline) {
    try {
      if (readOnly) {
        const comments = await api.getIssueComments(token, repoPath, issueNumber);
        if (knownComments === null) knownComments = comments.length;
        if (comments.length > knownComments) {
          const fresh = comments.slice(knownComments);
          log(`\n🎉 NPC 已回复 ${fresh.length} 条评论：`);
          for (const c of fresh) {
            log(`\n--- ${c.user?.login || 'unknown'} ---`);
            log(c.body);
          }
          log(`\nIssue 地址：${issueUrl}`);
          log(`继续追问：node bin/cnb-npc.js comment ${repoPath} ${issueNumber} "@CodeBuddy …"`);
          return;
        }
      } else {
        const npcPrs = await findNpcPrs(token, repoPath);
        if (npcPrs.length) {
          for (const pr of npcPrs) {
            log(`\n🎉 NPC 已提交 PR #${pr.number}: ${pr.title}`);
            log(`   ${WEB}/${repoPath}/-/pulls/${pr.number}`);
            if (opts.merge) {
              log('  正在自动合并（squash）…');
              try {
                await api.mergePull(token, repoPath, pr.number, { merge_style: 'squash' });
                log('  ✅ 已合并');
              } catch (e) {
                log(`  合并失败：${e.message}（可手动到页面合并）`);
              }
            }
          }
          return;
        }
        // 中间状态：评论在涨但没有 PR，说明 NPC 在干活，别傻等
        try {
          const n = (await api.getIssueComments(token, repoPath, issueNumber)).length;
          if (n > seenComments) {
            log(`\n💬 NPC 已在 Issue 下发言 ${n} 条（可能正在汇报进度），尚未提交 PR。`);
            seenComments = n;
          }
        } catch {
          /* 进度提示失败不影响轮询 */
        }
      }
    } catch {
      /* 单次轮询失败继续等 */
    }
    process.stdout.write(`\r  ${spinner[spin++ % 4]} 等待 NPC ${readOnly ? '回复评论' : '干活'}… 剩余 ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`);
    await sleep(intervalSec * 1000);
  }

  log(`\n⏰ 轮询超时（${timeoutSec}s），${readOnly ? 'NPC 还未回复评论' : 'NPC 还未提交 PR'}。`);
  log(`Issue 地址（可随时去页面查看/催办）：${issueUrl}`);
  log(`在 Issue 下再 @一次 CodeBuddy 可重新触发（注：编辑/重开不会重新触发）。`);
  process.exitCode = 2; // 超时 = 任务未完成，非零退出供 CI/自动化识别
}

/** 初始化 git 并推送代码到 CNB 仓库 */
async function pushToRepo(token, orgSlug, repoName, workDir) {
  const remote = `${WEB}/${orgSlug}/${repoName}.git`;
  const authRemote = `https://cnb:${encodeURIComponent(token)}@cnb.cool/${orgSlug}/${repoName}.git`;

  const gitRaw = (args) => {
    const r = spawnSync('git', args, { cwd: workDir, encoding: 'utf8' });
    if (r.error) fail(`git 执行失败（请确认已安装 git）：${r.error.message}`);
    return r; // { status, stdout, stderr }
  };
  const git = (args) => {
    const r = gitRaw(args);
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout || '').trim();
      fail(`git ${args[0]} 失败：${msg.slice(0, 400)}`);
    }
    return r.stdout ? r.stdout.trim() : '';
  };

  if (!fs.existsSync(path.join(workDir, '.git'))) git(['init']);
  // 确保有提交身份：仅当本地/全局都没有配置时才写入本地身份，避免覆盖用户已有配置
  try {
    if (!gitRaw(['config', 'user.name']).stdout.trim()) git(['config', 'user.name', 'cnb-npc']);
    if (!gitRaw(['config', 'user.email']).stdout.trim()) git(['config', 'user.email', 'cnb-npc@cnb.cool']);
  } catch {
    /* 忽略 */
  }
  // 确保至少有一个提交（空仓库时 rev-parse 失败属正常，不视为错误）
  const hasCommit = gitRaw(['rev-parse', '--verify', 'HEAD']).status === 0;
  if (!hasCommit) {
    git(['add', '-A']);
    git(['commit', '-m', 'init: cnb-npc task']);
  } else {
    const changed = git(['status', '--porcelain']);
    if (changed) {
      const n = changed.split('\n').filter(Boolean).length;
      log(`⚠️ 检测到 ${n} 个未提交改动，将全部提交（update: cnb-npc task）并推送给 NPC。`);
      git(['add', '-A']);
      git(['commit', '-m', 'update: cnb-npc task']);
    }
  }

  // 确认默认分支名
  let branch = 'main';
  try {
    const head = await api.getHead(token, `${orgSlug}/${repoName}`);
    if (head && head.name) branch = head.name;
  } catch {
    /* 新仓库没有分支，用 main */
  }

  // 用带 token 的 URL 推送（用户 cnb / 密码 token），推送后不落盘在 remote 里
  log(`推送代码到 ${remote}（分支 ${branch}）…`);
  git(['push', authRemote, `HEAD:${branch}`]);
  // 若平台默认分支与推送分支不一致（如新仓库默认 master），补充推送到默认分支
  try {
    const head2 = await api.getHead(token, `${orgSlug}/${repoName}`);
    if (head2 && head2.name && head2.name !== branch) {
      log(`平台默认分支为 ${head2.name}，补充推送…`);
      git(['push', authRemote, `HEAD:${head2.name}`]);
      branch = head2.name;
    }
  } catch {
    /* 忽略 */
  }
  // 用独立 remote 名（cnb）记录干净地址，绝不覆盖用户已有的 origin
  try {
    if (git(['remote']).includes('cnb')) git(['remote', 'set-url', 'cnb', remote]);
    else git(['remote', 'add', 'cnb', remote]);
  } catch {
    /* 非必须 */
  }
  log('✅ 代码已推送');
}

// ---------- comment / comments ----------

/** rest 头两项必须是 <owner/repo> <issue号> */
function parseRepoIssue(rest, usage) {
  const [repoPath, num] = rest;
  if (!repoPath || !repoPath.includes('/') || !/^\d+$/.test(String(num || ''))) {
    fail(usage);
  }
  return { repoPath, number: Number(num) };
}

function printComments(comments) {
  for (const c of comments) {
    log(`\n--- ${c.user?.login || 'unknown'}${c.created_at ? ` · ${c.created_at}` : ''} ---`);
    log(c.body);
  }
}

async function postComment(rest) {
  const usage = '用法：node bin/cnb-npc.js comment <owner/repo> <issue号> "<评论内容>"';
  const target = parseRepoIssue(rest, usage);
  const text = rest.slice(2).join(' ').trim();
  if (!text) fail(usage);
  const token = getToken();
  if (!token) fail('未配置 Token。请先运行： node bin/cnb-npc.js onboard');

  log(`向 ${target.repoPath} Issue #${target.number} 发送评论…`);
  try {
    await api.createIssueComment(token, target.repoPath, target.number, text);
  } catch (e) {
    fail(`发送评论失败：${e.message}`);
  }
  log('✅ 评论已发送（新评论里的 @CodeBuddy 会重新触发 NPC）');
}

async function listComments(rest, opts) {
  const usage =
    '用法：node bin/cnb-npc.js comments <owner/repo> <issue号> [--wait] [--timeout 秒] [--interval 秒]';
  const target = parseRepoIssue(rest, usage);
  const token = getToken();
  if (!token) fail('未配置 Token。请先运行： node bin/cnb-npc.js onboard');

  let comments;
  try {
    comments = await api.getIssueComments(token, target.repoPath, target.number);
  } catch (e) {
    fail(`读取评论失败：${e.message}`);
  }

  if (!opts.wait) {
    if (!comments.length) {
      log(`Issue #${target.number} 暂无评论：${WEB}/${target.repoPath}/-/issues/${target.number}`);
      return;
    }
    log(`Issue #${target.number} 共 ${comments.length} 条评论：`);
    printComments(comments);
    return;
  }

  // --wait：以当前评论数为基线，等新评论（收只读任务的报告）
  const timeoutSec = Number(opts.timeout) || 600;
  const intervalSec = Number(opts.interval) || 30;
  const deadline = Date.now() + timeoutSec * 1000;
  const baseline = comments.length;
  log(`当前 ${baseline} 条评论，开始等待新评论（超时 ${timeoutSec}s，每 ${intervalSec}s 一次），Ctrl+C 可中止…`);
  while (Date.now() < deadline) {
    await sleep(intervalSec * 1000);
    let fresh;
    try {
      const now = await api.getIssueComments(token, target.repoPath, target.number);
      fresh = now.slice(baseline);
    } catch {
      continue; // 单次轮询失败继续等
    }
    if (fresh.length) {
      log(`\n=== 收到 ${fresh.length} 条新评论 ===`);
      printComments(fresh);
      return;
    }
    process.stdout.write(`\r  等待新评论… 剩余 ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`);
  }
  log(`\n⏰ 等待新评论超时（${timeoutSec}s）。请到页面确认：${WEB}/${target.repoPath}/-/issues/${target.number}`);
  process.exitCode = 2; // 超时 = 产出未就绪，非零退出供 CI/自动化识别
}

// ---------- api（CNB OpenAPI 通用透传） ----------

async function apiPassthrough(rest, opts) {
  const usage =
    '用法：node bin/cnb-npc.js api <METHOD> <path> [--data <JSON>|--data @file.json]\n' +
    '示例：node bin/cnb-npc.js api PATCH /owner/repo/-/issues/1 --data \'{"title":"新标题"}\'';
  const [method, rawPath] = rest;
  if (!method || !rawPath) fail(usage);
  const m = String(method).toUpperCase();
  if (!/^[A-Z]+$/.test(m)) fail(`非法 HTTP 方法：${method}`);
  // Git Bash 会把 /xxx 参数转成本地盘符路径（MSYS 路径转换），提前指路
  if (/^[A-Za-z]:[\\/]/.test(rawPath)) {
    fail(
      '检测到 Windows 盘符路径：Git Bash 会自动把 /xxx 转换成本地路径。\n' +
        '请改用：MSYS_NO_PATHCONV=1 node bin/cnb-npc.js api …，或在 PowerShell/cmd 中运行。'
    );
  }
  const apiPath = `/${rawPath.replace(/^\/+/, '')}`;
  const token = getToken();
  if (!token) fail('未配置 Token。请先运行： node bin/cnb-npc.js onboard');

  let body;
  if (opts.data !== undefined) {
    if (typeof opts.data !== 'string') fail(usage);
    let raw = opts.data;
    if (raw.startsWith('@')) raw = fs.readFileSync(path.resolve(raw.slice(1)), 'utf8');
    try {
      body = JSON.parse(raw);
    } catch (e) {
      fail(`--data 不是合法 JSON：${e.message}`);
    }
  }

  try {
    const data = await api.request(m, apiPath, { token, body });
    log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } catch (e) {
    fail(`CNB API ${m} ${apiPath} 失败：${e.message}`);
  }
}

// ---------- main ----------

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  if (opts.help || rest.length === 0) {
    log(HELP);
    return;
  }
  const cmd = rest.shift();
  switch (cmd) {
    case 'onboard':
      await onboard({ noBrowser: Boolean(opts.noBrowser) });
      break;
    case 'status':
      await status();
      break;
    case 'run':
      await runTask(rest.join(' '), opts);
      break;
    case 'comment':
      await postComment(rest);
      break;
    case 'comments':
      await listComments(rest, opts);
      break;
    case 'api':
      await apiPassthrough(rest, opts);
      break;
    default:
      fail(`未知命令: ${cmd}\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
