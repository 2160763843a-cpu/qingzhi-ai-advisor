import express from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const app = express();

// 前端构建产物目录优先，旧静态页兜底
const DIST_DIR = path.join(__dirname, 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');
const hasDist = existsSync(path.join(DIST_DIR, 'index.html'));
const staticDir = hasDist ? DIST_DIR : PUBLIC_DIR;
if (!hasDist) console.error('[qingzhi-ai-advisor] 警告：未找到 dist/index.html，已回退 public/ —— 生产环境必须先构建！')
// 构建版本信息（从真实产物读取，不含敏感信息）
function readBuildInfo() {
  try {
    const html = readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8')
    const assets = [...html.matchAll(/assets\/([^"']+\.(?:js|css))/g)].map((m) => m[1])
    let gitCommit = ''
    try {
      gitCommit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim()
    } catch {
      try {
        const head = readFileSync(path.join(__dirname, '.git', 'HEAD'), 'utf8').trim()
        const ref = head.startsWith('ref:') ? head.slice(5) : null
        gitCommit = (ref ? readFileSync(path.join(__dirname, '.git', ref), 'utf8') : head).trim().slice(0, 7)
      } catch { gitCommit = 'unknown' }
    }
    return { gitCommit, builtAt: statSync(path.join(DIST_DIR, 'index.html')).mtime.toISOString(), frontend: 'vue-build', assets: { js: assets.find((a) => a.endsWith('.js')) ?? null, css: assets.find((a) => a.endsWith('.css')) ?? null } }
  } catch {
    return { gitCommit: 'unknown', builtAt: null, frontend: hasDist ? 'vue-build' : 'static-fallback', assets: { js: null, css: null } }
  }
}
const BUILD_INFO = readBuildInfo()

function readData(name) {
  return JSON.parse(readFileSync(path.join(__dirname, 'data', name), 'utf8'));
}

app.use(express.json());
app.get('/api/build-info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(BUILD_INFO) })

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'qingzhi-ai-advisor',
    env: process.env.NODE_ENV || 'development',
    frontend: hasDist ? 'vue-build' : 'static-fallback',
    ts: Date.now()
  });
});

app.get('/api/products', (req, res) => {
  try {
    res.json(readData('products.json'));
  } catch (err) {
    console.error('[api] products read failed:', err.message);
    res.status(500).json({ ok: false, error: 'products data unavailable' });
  }
});

app.get('/api/faqs', (req, res) => {
  try {
    res.json(readData('faqs.json'));
  } catch (err) {
    console.error('[api] faqs read failed:', err.message);
    res.status(500).json({ ok: false, error: 'faqs data unavailable' });
  }
});

app.get('/api/test-dialogues', (req, res) => {
  try {
    res.json(readData('test-dialogues.json'));
  } catch (err) {
    console.error('[api] test-dialogues read failed:', err.message);
    res.status(500).json({ ok: false, error: 'test-dialogues data unavailable' });
  }
});

app.use(express.static(staticDir, { index: false, setHeaders: (res, fp) => { if (fp.includes('/assets/')) { res.set('Cache-Control', 'public, max-age=31536000, immutable') } else { res.set('Cache-Control', 'no-store') } } }));

// SPA 深层路由 fallback：非 API 路径统一返回 index.html
app.use((req, res) => {
  if (req.path.startsWith('/assets/')) { res.status(404).set('Cache-Control', 'no-store').end(); return }
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'not found' });
  }
  res.set('Cache-Control', 'no-store')
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[qingzhi-ai-advisor] listening on http://0.0.0.0:${PORT} (env=${process.env.NODE_ENV || 'development'}, static=${hasDist ? 'dist' : 'public'})`);
});
