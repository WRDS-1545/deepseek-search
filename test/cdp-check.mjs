/**
 * 无头浏览器验收脚本（开发用）。
 * 依赖本机 Edge + Node 24 内置 WebSocket，不需要任何 npm 包。
 *
 * 用法见 test/run-browser-check.ps1。
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8787/?q=DeepSeek%20V4';
const OUT_DIR = path.resolve(process.env.OUT_DIR || 'docs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const notes = [];

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function waitForPort() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (response.ok) return await response.json();
    } catch {
      /* not ready */
    }
    await sleep(150);
  }
  throw new Error('DevTools endpoint did not become ready');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        const handlers = this.listeners.get(message.method) || [];
        for (const handler of handlers) handler(message.params);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const targets = await waitForPort();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No page target found');

  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (params) => {
    exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'unknown exception');
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      exceptions.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async function waitFor(expression, timeout = 12000, label = expression) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async function screenshot(file, { width = 1440, height = 1000, full = true, maxHeight = 4000 } = {}) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await sleep(300);
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const clipHeight = full ? Math.min(Math.ceil(size.height), maxHeight) : height;
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: full,
      clip: { x: 0, y: 0, width, height: clipHeight, scale: 1 },
    });
    await writeFile(path.join(OUT_DIR, file), Buffer.from(shot.data, 'base64'));
    const kb = Math.round((shot.data.length * 3) / 4 / 1024);
    console.log(`  · 截图 ${file} (${width}×${clipHeight}, ~${kb} KB)`);
  }

  console.log('DeepSeek Search · 浏览器验收');

  // 首页（未搜索）截图
  const baseUrl = new URL(APP_URL).origin + '/';
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor("document.readyState === 'complete'", 15000, 'home page load');
  await sleep(600);
  const heroVisible = await evaluate(
    "!!document.querySelector('#hero') && getComputedStyle(document.querySelector('#hero')).display !== 'none'",
  );
  check('首页展示 Hero 区域', heroVisible === true);
  await screenshot('hero.png', { full: true });

  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor("document.readyState === 'complete'", 15000, 'page load');
  await waitFor("document.querySelectorAll('.result-card').length === 10", 15000, '10 result cards');
  await sleep(600);

  const summary = await evaluate(`(() => ({
    count: document.querySelectorAll('.result-card').length,
    countText: document.querySelector('#resultCount').textContent,
    timeText: document.querySelector('#resultTime').textContent,
    firstTitle: document.querySelector('.result-title a').textContent.trim(),
    markBg: getComputedStyle(document.querySelector('.result-title mark')).backgroundColor,
    emptyHidden: document.querySelector('#emptyBox').hidden,
    selection: String(window.getSelection()),
    active: document.activeElement ? document.activeElement.id : '',
    inputSelection: [
      document.querySelector('#queryInput').selectionStart,
      document.querySelector('#queryInput').selectionEnd
    ],
    errors: document.querySelectorAll('[id]').length === new Set([...document.querySelectorAll('[id]')].map(e => e.id)).size
  }))()`);

  check('渲染 10 条结果', summary.count === 10, String(summary.count));
  check('结果计数文案正确', summary.countText === '找到 10 条结果', summary.countText);
  check('显示 API 耗时', /用时 0\.\d{2} 秒/.test(summary.timeText), summary.timeText);
  check('关键词高亮使用主题色（非浏览器默认黄）', !summary.markBg.includes('255, 255, 0'), summary.markBg);
  check('空状态默认隐藏', summary.emptyHidden === true);
  check('页面 ID 唯一', summary.errors === true);
  check('无 JS 异常', exceptions.length === 0, exceptions.join(' | '));
  notes.push(`首条结果：${summary.firstTitle}`);
  notes.push(`输入框状态：active=${summary.active || 'body'}, selection=${JSON.stringify(summary.selection)}, range=${summary.inputSelection.join('-')}`);

  await screenshot('preview.png', { full: true });

  // 深色模式（初始状态，便于 README 展示）
  await evaluate(`document.querySelector('#themeBtn').click()`);
  await sleep(350);
  const theme = await evaluate(`document.documentElement.dataset.theme`);
  check('深色模式切换生效', theme === 'dark', theme);
  await screenshot('dark.png', { full: true });
  await evaluate(`document.querySelector('#themeBtn').click()`);
  await sleep(250);

  // 移动端（初始状态）
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(450);
  const mobile = await evaluate(`(() => {
    const card = document.querySelector('.result-card');
    const bar = document.querySelector('.search-bar');
    return {
      cardWidth: Math.round(card.getBoundingClientRect().width),
      barWidth: Math.round(bar.getBoundingClientRect().width),
      bodyScroll: document.documentElement.scrollWidth <= window.innerWidth + 1
    };
  })()`);
  check('移动端无横向溢出', mobile.bodyScroll === true, JSON.stringify(mobile));
  await screenshot('mobile.png', { width: 390, height: 844, full: false });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(350);

  // 展开详情
  await evaluate(`document.querySelector('.result-card [data-act="detail"]').click()`);
  await waitFor("!!document.querySelector('.result-card .result-detail')", 4000, 'detail panel');
  const detailOpen = await evaluate(`(() => ({
    text: document.querySelector('.result-detail').textContent,
    button: document.querySelector('.result-card [data-act="detail"]').textContent.trim()
  }))()`);
  check('详情面板可展开', detailOpen.text.includes('长摘要'), detailOpen.text.slice(0, 50));
  check('详情按钮变为「收起」', detailOpen.button.includes('收起'), detailOpen.button);

  // 抓取正文
  await evaluate(`document.querySelectorAll('.result-card')[1].querySelector('[data-act="fetch"]').click()`);
  await waitFor("!!document.querySelectorAll('.result-card')[1].querySelector('.detail-content')", 8000, 'fetched content');
  const fetched = await evaluate(`(() => {
    const card = document.querySelectorAll('.result-card')[1];
    return {
      length: card.querySelector('.detail-content').textContent.length,
      hasDocButton: !!card.querySelector('[data-act="content"]'),
      buttonText: card.querySelector('.result-actions').textContent
    };
  })()`);
  check('Fetch 正文渲染成功', fetched.length > 50, `${fetched.length} 字符`);
  check('正文按钮切换为「正文」', fetched.hasDocButton === true);

  // 筛选
  await evaluate(`document.querySelector('[data-filter="quality"]').click()`);
  await sleep(250);
  const quality = await evaluate(`(() => ({
    cards: document.querySelectorAll('.result-card').length,
    text: document.querySelector('#resultCount').textContent
  }))()`);
  check('优质筛选生效（7 条）', quality.cards === 7, `${quality.cards} 条 / ${quality.text}`);

  await evaluate(`document.querySelector('[data-filter="all"]').click()`);

  // 排序
  await evaluate(`(() => {
    const select = document.querySelector('#sortSelect');
    select.value = 'date';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(250);
  const firstByDate = await evaluate(`document.querySelector('.result-title a').textContent.trim()`);
  check('按时间排序生效', firstByDate.includes('11 月 1 日'), firstByDate);

  // API Key 弹窗
  await evaluate(`document.querySelector('#keyBtn').click()`);
  await waitFor("document.querySelector('#keyDialog').open === true", 4000, 'key dialog open');
  const keyDialog = await evaluate(`(() => ({
    open: document.querySelector('#keyDialog').open,
    status: document.querySelector('#keyServerText').textContent,
    state: document.querySelector('#keyServerStatus').dataset.state,
    hasInput: !!document.querySelector('#apiKeyInput')
  }))()`);
  check('API Key 弹窗可打开', keyDialog.open === true && keyDialog.hasInput === true);
  check('弹窗显示服务端密钥状态', keyDialog.state === 'on' && keyDialog.status.includes('服务端已配置'), keyDialog.status);
  await evaluate(`document.querySelector('#keyCloseBtn').click()`);
  await waitFor("document.querySelector('#keyDialog').open === false", 4000, 'key dialog closed');

  // 可选：无服务端 Key 的首次使用流程
  if (process.env.KEYFLOW_URL) {
    const flowUrl = new URL(process.env.KEYFLOW_URL);
    flowUrl.searchParams.set('q', '首次配置测试');
    await cdp.send('Page.navigate', { url: flowUrl.href });
    await waitFor("document.readyState === 'complete'", 15000, 'keyflow load');
    await waitFor("document.querySelector('#keyDialog').open === true", 8000, 'key dialog auto open');
    const firstRun = await evaluate(`(() => ({
      open: document.querySelector('#keyDialog').open,
      status: document.querySelector('#keyServerText').textContent,
      state: document.querySelector('#keyServerStatus').dataset.state,
      query: document.querySelector('#queryInput').value,
      focused: document.activeElement ? document.activeElement.id : ''
    }))()`);
    check('未配置 Key 时搜索自动打开设置弹窗', firstRun.open === true);
    check('弹窗提示服务端未配置 Key', firstRun.state === 'off' && firstRun.status.includes('尚未配置'), firstRun.status);
    check('保留待搜索词', firstRun.query === '首次配置测试', firstRun.query);
    await screenshot('key-dialog.png', { width: 1440, height: 1000, full: false });

    await evaluate(`(() => {
      const input = document.querySelector('#apiKeyInput');
      input.value = 'sk-browser-key';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#keyForm').requestSubmit();
    })()`);
    await waitFor("document.querySelector('#keyDialog').open === false", 5000, 'key dialog closed after save');
    await waitFor("document.querySelectorAll('.result-card').length === 10", 12000, 'search after saving key');
    const afterSave = await evaluate(`(() => ({
      cards: document.querySelectorAll('.result-card').length,
      stored: Boolean(localStorage.getItem('ds-search:api-key')),
      dot: document.querySelector('#keyDot').dataset.state,
      error: document.querySelector('#errorBox').hidden === false
    }))()`);
    check('保存 Key 后自动执行待搜索', afterSave.cards === 10, `${afterSave.cards} 条`);
    check('Key 保存到浏览器存储且指示灯变绿', afterSave.stored === true && afterSave.dot === 'on');
    check('保存后无错误提示', afterSave.error === false);
  }

  // 可选：上游 401 错误状态（使用无效 Key 的实例）
  if (process.env.ERROR_URL) {
    const errorUrl = new URL(process.env.ERROR_URL);
    errorUrl.searchParams.set('q', '错误状态测试');
    await cdp.send('Page.navigate', { url: errorUrl.href });
    await waitFor("document.readyState === 'complete'", 15000, 'error page load');
    await waitFor("document.querySelector('#errorBox').hidden === false", 30000, 'error box visible');
    const errorState = await evaluate(`(() => ({
      title: document.querySelector('#errorTitle').textContent,
      message: document.querySelector('#errorMessage').textContent,
      count: document.querySelector('#resultCount').textContent,
      retry: !!document.querySelector('#retryBtn')
    }))()`);
    check('401 错误状态渲染', errorState.title.includes('API Key'), errorState.title);
    check('错误信息透传上游原因', /invalid|Authentication/i.test(errorState.message), errorState.message);
    check('错误状态显示重试入口', errorState.retry === true && errorState.count === '搜索失败');
    await screenshot('error-state.png', { width: 1440, height: 1000, full: false });
  }

  check('最终无 JS 异常', exceptions.length === 0, exceptions.join(' | '));

  cdp.close();

  console.log('');
  for (const note of notes) console.log(`  ℹ ${note}`);
  if (failures.length) {
    console.error(`\n  ${failures.length} 项检查失败：`);
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\n  全部检查通过。');
  }
}

main().catch((error) => {
  console.error('\n验收脚本失败：', error.message);
  process.exit(1);
});
