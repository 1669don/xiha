/**
 * Cloudflare Worker — 想法记录 后端 API
 *
 * 作用：作为前端与 GitHub 仓库之间的安全代理。
 *       前端不直接暴露 GitHub Token，所有读写通过 Worker 中转。
 *
 * API:
 *   GET  /api/ideas  →  获取全部想法数据 + 版本 SHA
 *   POST /api/ideas  →  保存全部想法数据（防止冲突需要传入 SHA）
 *
 * 环境变量（通过 wrangler secret 设置）:
 *   GITHUB_TOKEN  — GitHub Personal Access Token（contents:write 权限）
 *   GITHUB_OWNER  — GitHub 用户名
 *   GITHUB_REPO   — 存储数据的仓库名
 *   GITHUB_PATH   — 数据文件路径，默认 "ideas.json"
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return cors(null, 204);
    }

    if (url.pathname === '/api/ideas') {
      if (request.method === 'GET')  return handleGet(env);
      if (request.method === 'POST') return handlePost(request, env);
    }

    return cors({ error: 'Not Found' }, 404);
  }
};

// ===================== GET =====================
async function handleGet(env) {
  const { owner, repo, path, token } = config(env);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ideas-app'
    }
  });

  if (res.status === 404) {
    // 文件还不存在，返回空数据
    return cors({ data: { mine: [], friend: [] }, sha: null });
  }

  if (!res.ok) {
    const err = await res.text();
    return cors({ error: 'GitHub 读取失败: ' + err }, res.status);
  }

  const file = await res.json();
  let data;
  try {
    data = JSON.parse(atob(file.content));
  } catch (e) {
    data = { mine: [], friend: [] };
  }

  return cors({ data, sha: file.sha });
}

// ===================== POST =====================
async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors({ error: '请求格式错误' }, 400);
  }

  const { data, sha } = body;
  if (!data || typeof data !== 'object') {
    return cors({ error: '缺少 data 字段' }, 400);
  }

  // 确保数据结构正确
  const payload = {
    mine: Array.isArray(data.mine) ? data.mine : [],
    friend: Array.isArray(data.friend) ? data.friend : []
  };

  const { owner, repo, path, token } = config(env);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

  const putBody = {
    message: '💡 更新想法记录',
    content,
    branch: 'main'
  };
  if (sha) putBody.sha = sha;

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ideas-app',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(putBody)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return cors({ error: 'conflict', message: '数据已被其他人修改，请刷新后重试' }, 409);
    }
    return cors({ error: err.message || 'GitHub 写入失败' }, res.status);
  }

  const result = await res.json();
  return cors({ sha: result.content.sha });
}

// ===================== 工具 =====================
function config(env) {
  return {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    path: env.GITHUB_PATH || 'ideas.json',
    token: env.GITHUB_TOKEN
  };
}

function cors(body, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}
