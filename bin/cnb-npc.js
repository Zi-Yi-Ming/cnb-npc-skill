#!/usr/bin/env node
// cnb-npc —— 让 CNB CodeBuddy NPC 替自己上班。
// 子命令：
//   onboard          首次引导：检测 Token → 浏览器跳转 → 粘贴 → 校验 → 存配置
//   run "<任务>"     端到端编排：建组织/仓库 → 推送代码 → 开 Issue(@CodeBuddy+工作模式) → 轮询 → 汇报 PR
//   status           查看 Token / 组织 / 仓库状态
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { getToken, loadConfig, saveConfig, configPath } from '../lib/config.js';
import * as api from '../lib/api.js';

const WEB = 'https://cnb.cool';
const HELP = `cnb-npc —— 让 CNB CodeBuddy NPC 替自己上班

用法:
  node bin/cnb-npc.js onboard                         首次引导（注册/生成 Token）
  node bin/cnb-npc.js run "<任务描述>" [选项]          一键派发任务给 CodeBuddy NPC
  node bin/cnb-npc.js status                          查看配置状态
  node bin/cnb-npc.js --help                          显示帮助

run 选项:
  --org <slug>         组织路径（默认：取你已有的第一个组织，没有则创建 npc-workspace）
  --repo <name>        仓库名（默认：npc-task）
  --dir <路径>         本地代码目录（默认：生成一个带任务说明的 README 空仓库）
  --visibility <v>     仓库可见性 public|private|secret（默认 private）
  --timeout <秒>       轮询超时（默认 3600）
  --interval <秒>      轮询间隔（默认 30）
  --merge              检测到 NPC 的 PR 后自动 squash 合并
  --no-browser         不自动打开浏览器（onboard 时配合手动访问）

环境变量:
  CNB_TOKEN            访问令牌（优先于本地配置文件）

首次使用:
  1) node bin/cnb-npc.js onboard
  2) 按提示在浏览器完成注册并生成访问令牌（需勾选 group-manage:rw / group-resource:rw / repo-issue:rw）
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

/** 把任务描述转成合法的仓库名 */
function slugify(text, max = 40) {
  const s = (text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (s || 'npc-task').slice(0, max);
}

/** 等待 sleep 毫秒 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在 repo 里找 NPC 创建的 PR（author.is_npc 或 npc-observability） */
async function findNpcPrs(token, repoPath) {
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
        `  1) 打开 ${WEB}/profile/token 生成访问令牌（勾选 group-manage:rw、group-resource:rw、repo-issue:rw）\n` +
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
  log('  添加访问令牌时，请勾选以下授权范围：');
  log('    - 组织：group-manage:rw（自动建组织）');
  log('    - 仓库：group-resource:rw（自动建仓库）');
  log('    - Issue：repo-issue:rw（自动开 Issue）');

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

  const token = getToken();
  if (!token) {
    log('未检测到 Token，先进入首次引导…\n');
    await onboard({ noBrowser: opts.noBrowser });
    if (!getToken()) fail('未获取到 Token，已中止。');
  }

  log(`\n===== 派发任务给 CodeBuddy NPC =====`);
  log(`任务: ${task}`);

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
  if (!repo) {
    log(`创建仓库 ${repoPath}…`);
    await api.createRepo(token, orgSlug, {
      name: repoName,
      description: `npc task: ${task.slice(0, 80)}`,
      visibility: opts.visibility || 'private',
    });
    repo = await api.getRepo(token, repoPath);
  } else {
    log(`复用已有仓库 ${repoPath}`);
  }

  // 3. 准备本地目录并推送
  const workDir = opts.dir ? path.resolve(opts.dir) : fs.mkdtempSync(path.join(os.tmpdir(), 'cnb-npc-'));
  if (!opts.dir) {
    fs.writeFileSync(
      path.join(workDir, 'README.md'),
      `# NPC 任务\n\n${task}\n\n> 由 cnb-npc 自动创建，等待 CodeBuddy NPC 完成。\n`
    );
  }
  log(`本地目录: ${workDir}`);
  await pushToRepo(token, orgSlug, repoName, workDir);

  // 4. 开 Issue：@CodeBuddy 必须在纯文本里 + work_mode=true
  const body = `@CodeBuddy 请完成以下开发任务：

## 任务
${task}

## 要求
- 工作模式已开启，请直接编写代码、创建分支并提交 PR
- 完成后请在评论中说明实现思路和改动点
`;
  log(`创建 Issue（@CodeBuddy + 工作模式）…`);
  let issue;
  try {
    issue = await api.createIssue(token, repoPath, {
      title: task.slice(0, 255),
      body,
      work_mode: true,
    });
  } catch (e) {
    fail(`创建 Issue 失败：${e.message}`);
  }
  const issueNumber = issue ? issue.number : '?';
  const issueUrl = `${WEB}/${repoPath}/-/issues/${issueNumber}`;
  log(`Issue #${issueNumber}: ${issueUrl}`);

  // 5. 轮询：等 NPC 的 PR 或超时
  const timeoutSec = Number(opts.timeout) || 3600;
  const intervalSec = Number(opts.interval) || 30;
  const deadline = Date.now() + timeoutSec * 1000;
  log(`\n开始轮询 NPC 进度（超时 ${timeoutSec}s，每 ${intervalSec}s 一次），Ctrl+C 可中止…`);
  const spinner = ['|', '/', '-', '\\'];
  let spin = 0;

  while (Date.now() < deadline) {
    try {
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
    } catch {
      /* 单次轮询失败继续等 */
    }
    process.stdout.write(`\r  ${spinner[spin++ % 4]} 等待 NPC 干活… 剩余 ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`);
    await sleep(intervalSec * 1000);
  }

  log(`\n⏰ 轮询超时（${timeoutSec}s），NPC 还未提交 PR。`);
  log(`Issue 地址（可随时去页面查看/催办）：${issueUrl}`);
  log(`在 Issue 下再 @一次 CodeBuddy 可重新触发（注：编辑/重开不会重新触发）。`);
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
  // 确保有提交身份（无全局 git 配置时也能 commit）
  try {
    git(['config', 'user.name', 'cnb-npc']);
    git(['config', 'user.email', 'cnb-npc@cnb.cool']);
  } catch {
    /* 已有全局配置，忽略 */
  }
  // 确保至少有一个提交（空仓库时 rev-parse 失败属正常，不视为错误）
  const hasCommit = gitRaw(['rev-parse', '--verify', 'HEAD']).status === 0;
  if (!hasCommit) {
    git(['add', '-A']);
    git(['commit', '-m', 'init: cnb-npc task']);
  } else {
    const changed = git(['status', '--porcelain']);
    if (changed) {
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
  // 把 remote 换成不带 token 的干净地址
  try {
    if (git(['remote']).includes('origin')) git(['remote', 'set-url', 'origin', remote]);
    else git(['remote', 'add', 'origin', remote]);
  } catch {
    /* 非必须 */
  }
  log('✅ 代码已推送');
}

// ---------- main ----------

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  return { opts, rest };
}

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
    default:
      fail(`未知命令: ${cmd}\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
