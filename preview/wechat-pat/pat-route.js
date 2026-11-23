'use strict';

/**
 * 拍一拍设置页（http://127.0.0.1:<端口>/pat）。
 *
 * 启动器是封装好的 exe，没有可扩展的插件页面；这里由内核自己发一个
 * 纯本机设置页，改的是 config.json 的 pat.*，和启动器改配置走同一个
 * applyConfigPatch（同样做范围校验、同样写回 config.json）。
 *
 * 页面只用同源外部脚本/样式：内核的 CSP 是 script-src 'self'，
 * 内联 <script> 会被浏览器直接拦掉。
 */

const { json, readBody } = require('../util');
const { applyConfigPatch } = require('../../infra/configPatch');
const { isOn } = require('../../infra/features');
const { errorMessage } = require('../../infra/errors');

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>鲸鲸 · 拍一拍</title>
<link rel="stylesheet" href="/pat/app.css">
</head>
<body>
<main class="card">
  <header>
    <h1>拍一拍</h1>
    <p class="sub">别人在微信里拍鲸鲸时，她怎么回应。改完立即生效，不用重启。</p>
  </header>

  <section class="row">
    <div class="row-main">
      <div class="row-title">启用拍一拍</div>
      <div class="row-desc">关闭后不识别、不回应；说「拍拍我」也不会拍。</div>
    </div>
    <label class="switch">
      <input id="enabled" type="checkbox">
      <span class="slider"></span>
    </label>
  </section>

  <section class="field">
    <div class="field-head">
      <label for="replyChance">被拍后回一句话的概率</label>
      <output id="replyChanceOut">100%</output>
    </div>
    <input id="replyChance" type="range" min="0" max="100" step="5" value="100">
    <div class="field-desc">0% = 只回拍、不说话；100% = 每次都回一句很短的话。</div>
  </section>

  <section class="field">
    <div class="field-head">
      <label for="backChance">被拍后回拍的概率</label>
      <output id="backChanceOut">100%</output>
    </div>
    <input id="backChance" type="range" min="0" max="100" step="5" value="100">
    <div class="field-desc">只对私聊生效。群里拍一拍无法指定拍谁，所以群里只回话、不主动拍。</div>
  </section>

  <section class="grid">
    <div class="field">
      <div class="field-head"><label for="cooldownSec">同一会话最小间隔（秒）</label></div>
      <input id="cooldownSec" type="number" min="0" max="3600" step="1" value="8">
      <div class="field-desc">两次回拍之间至少隔多久；0 = 不限制。</div>
    </div>
    <div class="field">
      <div class="field-head"><label for="maxPerHour">每小时最多回拍（次）</label></div>
      <input id="maxPerHour" type="number" min="0" max="200" step="1" value="0">
      <div class="field-desc">0 = 不限；防止被连续拍时刷屏。</div>
    </div>
  </section>

  <footer>
    <button id="save" class="primary" type="button">保存</button>
    <button id="reset" type="button">恢复默认</button>
    <span id="status" class="status"></span>
  </footer>
</main>
<script src="/pat/app.js"></script>
</body>
</html>`;

const CSS = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(1200px 600px at 20% 0%, #16324a 0%, #0b1118 55%, #070a0e 100%);
  color: #e8eef5; font: 14px/1.6 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  padding: 24px;
}
.card {
  width: min(640px, 100%);
  background: rgba(16, 24, 34, 0.86);
  border: 1px solid rgba(120, 170, 220, 0.18);
  border-radius: 18px;
  padding: 26px 26px 20px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}
h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 1px; }
.sub { margin: 0 0 20px; color: #8ea3b8; font-size: 13px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(120, 170, 220, 0.10); margin-bottom: 18px; }
.row-title { font-weight: 600; }
.row-desc, .field-desc { color: #8296ab; font-size: 12px; margin-top: 4px; }
.field { margin-bottom: 16px; }
.field-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
output { color: #7fd4ff; font-variant-numeric: tabular-nums; }
input[type="range"] { width: 100%; accent-color: #4fb6e8; }
input[type="number"] {
  width: 100%; padding: 8px 10px; border-radius: 10px; color: #e8eef5;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(120, 170, 220, 0.20);
  font: inherit;
}
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.switch { position: relative; width: 46px; height: 26px; flex: none; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; border-radius: 999px; background: #2a3a4a; transition: .2s; cursor: pointer; }
.slider::before { content: ""; position: absolute; width: 20px; height: 20px; border-radius: 50%;
  left: 3px; top: 3px; background: #9fb3c6; transition: .2s; }
.switch input:checked + .slider { background: #2f7ea8; }
.switch input:checked + .slider::before { transform: translateX(20px); background: #eaf8ff; }
footer { display: flex; align-items: center; gap: 10px; margin-top: 20px; }
button { padding: 9px 18px; border-radius: 10px; border: 1px solid rgba(120, 170, 220, 0.25);
  background: rgba(255, 255, 255, 0.05); color: #dce8f3; font: inherit; cursor: pointer; }
button:hover { background: rgba(255, 255, 255, 0.10); }
button.primary { background: linear-gradient(180deg, #2f8fc0, #256f97); border-color: #2f8fc0; color: #fff; }
.status { margin-left: auto; color: #8ea3b8; font-size: 12px; }
.status.ok { color: #6fd39a; }
.status.err { color: #ff8d8d; }
@media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
`;

const JS = `(function () {
  var el = function (id) { return document.getElementById(id); };
  var status = el('status');

  function say(text, kind) {
    status.textContent = text || '';
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setPct(slider, out, value) {
    var pct = Math.round(Number(value) * 100);
    slider.value = String(pct);
    out.textContent = pct + '%';
  }

  function paint(data) {
    el('enabled').checked = data.enabled !== false;
    setPct(el('replyChance'), el('replyChanceOut'), data.replyChance);
    setPct(el('backChance'), el('backChanceOut'), data.backChance);
    el('cooldownSec').value = String(data.cooldownSec);
    el('maxPerHour').value = String(data.maxPerHour);
  }

  function body() {
    return {
      enabled: el('enabled').checked,
      replyChance: Number(el('replyChance').value) / 100,
      backChance: Number(el('backChance').value) / 100,
      cooldownSec: Number(el('cooldownSec').value),
      maxPerHour: Number(el('maxPerHour').value)
    };
  }

  function load() {
    fetch('/api/pat', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) paint(d); else say('读取失败：' + ((d && d.error) || '未知错误'), 'err'); })
      .catch(function (e) { say('读取失败：' + e.message, 'err'); });
  }

  function save() {
    say('保存中…');
    fetch('/api/pat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body())
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (out) {
        if (!out.ok || !out.d || out.d.ok !== true) {
          say('保存失败：' + ((out.d && out.d.error) || '未知错误'), 'err');
          return;
        }
        paint(out.d);
        say('已保存，立即生效', 'ok');
      })
      .catch(function (e) { say('保存失败：' + e.message, 'err'); });
  }

  function reset() {
    el('replyChance').value = '100';
    el('backChance').value = '100';
    el('enabled').checked = true;
    el('cooldownSec').value = '8';
    el('maxPerHour').value = '0';
    el('replyChanceOut').textContent = '100%';
    el('backChanceOut').textContent = '100%';
    say('已填回默认值，点「保存」才会写入');
  }

  el('replyChance').addEventListener('input', function () {
    el('replyChanceOut').textContent = el('replyChance').value + '%';
  });
  el('backChance').addEventListener('input', function () {
    el('backChanceOut').textContent = el('backChance').value + '%';
  });
  el('save').addEventListener('click', save);
  el('reset').addEventListener('click', reset);
  load();
})();`;

function text(res, contentType, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function clampNumber(value, name, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw Object.assign(new Error(name + ' 要填数字'), { statusCode: 400 });
  if (n < min || n > max) throw Object.assign(new Error(name + ' 要在 ' + min + '~' + max + ' 之间'), { statusCode: 400 });
  return n;
}

function current(runtime) {
  const cfg = runtime.config && runtime.config.pat ? runtime.config.pat : {};
  const clamp = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    ok: true,
    enabled: isOn(runtime.config, 'pat'),
    replyChance: clamp(cfg.replyChance, 1),
    backChance: clamp(cfg.backChance, 1),
    cooldownSec: clamp(cfg.cooldownSec, 8),
    maxPerHour: clamp(cfg.maxPerHour, 0),
  };
}

module.exports = function register(router) {
  router.get('/pat', (runtime, req, res) => text(res, 'text/html; charset=utf-8', PAGE));
  router.get('/pat/app.css', (runtime, req, res) => text(res, 'text/css; charset=utf-8', CSS));
  router.get('/pat/app.js', (runtime, req, res) => text(res, 'text/javascript; charset=utf-8', JS));
  router.get('/api/pat', (runtime, req, res) => json(res, 200, current(runtime)));

  router.post('/api/pat', async (runtime, req, res) => {
    const body = (await readBody(req)) || {};
    try {
      const patch = {};
      if (body.enabled !== undefined) patch['features.pat'] = body.enabled === true || body.enabled === 'true';
      if (body.replyChance !== undefined) patch['pat.replyChance'] = clampNumber(body.replyChance, '回话概率', 0, 1);
      if (body.backChance !== undefined) patch['pat.backChance'] = clampNumber(body.backChance, '回拍概率', 0, 1);
      if (body.cooldownSec !== undefined) patch['pat.cooldownSec'] = clampNumber(body.cooldownSec, '最小间隔', 0, 3600);
      if (body.maxPerHour !== undefined) patch['pat.maxPerHour'] = clampNumber(body.maxPerHour, '每小时上限', 0, 200);
      if (!Object.keys(patch).length) throw Object.assign(new Error('没有要保存的字段'), { statusCode: 400 });
      applyConfigPatch(runtime, patch);
      return json(res, 200, current(runtime));
    } catch (err) {
      return json(res, err && err.statusCode ? err.statusCode : 400,
        { ok: false, error: errorMessage(err, '保存拍一拍设置失败') });
    }
  });
};
