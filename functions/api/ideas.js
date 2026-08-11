/**
 * Cloudflare Pages Function — /api/ideas
 *
 * 自动被 Pages 识别，不需要额外部署 Worker。
 *
 * 环境变量（在 Pages 后台 Settings → Environment variables 设置）:
 *   GITHUB_TOKEN  — GitHub Fine-grained Token (Contents: Read & Write)
 *   GITHUB_OWNER  — GitHub 用户名
 *   GITHUB_REPO   — 仓库名
 *   GITHUB_PATH   — 数据文件路径，默认 "ideas.json"
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS 预检（本地开发用）
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (url.pathname === '/api/ideas') {
    if (request.method === 'GET')  return handleGet(env);
    if (request.method === 'POST') return handlePost(request, env);
  }

  return json({ error: 'Not Found' }, 404);
}

// ===================== GET =====================
async function handleGet(env) {
  const { owner, repo, path, token } = config(env);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  try {
    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'ideas-app'
      }
    });

    if (res.status === 404) {
      return json({ data: { mine: [], friend: [] }, sha: null });
    }

    if (!res.ok) {
      const err = await res.text();
      return json({ error: 'GitHub 读取失败' }, res.status);
    }

    const file = await res.json();
    let data;
    try {
      data = JSON.parse(atob(file.content));
    } catch (e) {
      data = { mine: [], friend: [] };
    }

    return json({ data, sha: file.sha });
  } catch (e) {
    return json({ error: '网络错误: ' + e.message }, 500);
  }
}

// ===================== POST =====================
async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const { data, sha } = body;
  if (!data || typeof data !== 'object') {
    return json({ error: '缺少 data 字段' }, 400);
  }

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

  try {
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

    if (res.status === 409) {
      return json({ error: 'conflict', message: '数据已被其他人修改，请刷新后重试' }, 409);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json({ error: err.message || 'GitHub 写入失败' }, res.status);
    }

    const result = await res.json();
    return json({ sha: result.content.sha });
  } catch (e) {
    return json({ error: '网络错误: ' + e.message }, 500);
  }
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
