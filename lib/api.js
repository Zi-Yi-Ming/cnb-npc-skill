// CNB OpenAPI 客户端（https://api.cnb.cool）。
// 封装本项目用到的接口；request() 同时导出，供 CLI 的 api 透传命令使用。字段名以官方 swagger.json 为准。
const BASE = 'https://api.cnb.cool';
const ACCEPT = 'application/vnd.cnb.api+json';

export async function request(method, apiPath, { token, body } = {}) {
  const headers = { Accept: ACCEPT };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + apiPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = new Error(
      `CNB API ${method} ${apiPath} -> ${res.status}: ${
        typeof data === 'string' ? data : JSON.stringify(data).slice(0, 200)
      }`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---- 组织 ----
export const getUserGroups = (token) => request('GET', '/user/groups', { token });
export const createGroup = (token, { path, description, remark }) =>
  request('POST', '/groups', { token, body: { path, description, remark } });

// ---- 仓库 ----
export const createRepo = (token, slug, { name, description, visibility }) =>
  request('POST', `/${slug}/-/repos`, { token, body: { name, description, visibility } });

/** 仓库详情；404 返回 null（用于探测仓库是否已存在）。 */
export async function getRepo(token, fullPath) {
  try {
    return await request('GET', `/${fullPath}`, { token });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** 默认分支（新仓库可能还没有提交，返回 null）。 */
export async function getHead(token, repo) {
  try {
    return await request('GET', `/${repo}/-/git/head`, { token });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// ---- Issue ----
export const createIssue = (token, repo, form) =>
  request('POST', `/${repo}/-/issues`, { token, body: form });
export const getIssueComments = (token, repo, number) =>
  request('GET', `/${repo}/-/issues/${number}/comments`, { token });
/** 在 Issue 下发评论（重触发 NPC / 多轮追问）。 */
export const createIssueComment = (token, repo, number, body) =>
  request('POST', `/${repo}/-/issues/${number}/comments`, { token, body: { body } });

// ---- PR ----
export const getPulls = (token, repo) => request('GET', `/${repo}/-/pulls`, { token });
export const mergePull = (token, repo, number, { merge_style = 'squash' } = {}) =>
  request('PUT', `/${repo}/-/pulls/${number}/merge`, { token, body: { merge_style } });

// ---- NPC 可观测性 ----
export const getNpcPrs = (token, repo) =>
  request('GET', `/${repo}/-/npc-observability/prs`, { token });
