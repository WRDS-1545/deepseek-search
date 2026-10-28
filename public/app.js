/* ==========================================================================
   DeepSeek Search · 前端逻辑
   纯原生 JavaScript，无构建步骤
   ========================================================================== */

(() => {
  'use strict';

  const STORAGE = {
    key: 'ds-search:api-key',
    history: 'ds-search:history',
    theme: 'ds-search:theme',
    prefs: 'ds-search:prefs',
    hint: 'ds-search:key-hint',
  };

  const MAX_QUERY = 128;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (id) => document.getElementById(id);
  const icon = (name, className = 'icon') => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${name}`);
    svg.append(use);
    return svg;
  };
  const el = (tag, className = '', text = null) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
  };
  const spinner = (className = 'spinner') => icon('i-spinner', className);

  const dom = {
    siteHeader: $('siteHeader'),
    hero: $('hero'),
    form: $('searchForm'),
    input: $('queryInput'),
    clearBtn: $('clearBtn'),
    charCount: $('charCount'),
    searchBtn: $('searchBtn'),
    searchSpinner: $('searchSpinner'),
    searchLabel: $('searchBtn').querySelector('.btn-label'),
    quickRow: $('quickRow'),
    advToggle: $('advToggle'),
    advPanel: $('advPanel'),
    countInput: $('countInput'),
    countOut: $('countOut'),
    oriInput: $('oriInput'),
    localInput: $('localInput'),
    needContent: $('needContent'),
    historyRow: $('historyRow'),
    historyChips: $('historyChips'),
    clearHistoryBtn: $('clearHistoryBtn'),
    resultsSection: $('resultsSection'),
    resultCount: $('resultCount'),
    resultTime: $('resultTime'),
    skeletonList: $('skeletonList'),
    errorBox: $('errorBox'),
    errorTitle: $('errorTitle'),
    errorMessage: $('errorMessage'),
    retryBtn: $('retryBtn'),
    errorKeyBtn: $('errorKeyBtn'),
    errorDocsLink: $('errorDocsLink'),
    emptyBox: $('emptyBox'),
    emptyTitle: $('emptyTitle'),
    emptyMessage: $('emptyMessage'),
    emptyResetFilterBtn: $('emptyResetFilterBtn'),
    emptySyntaxBtn: $('emptySyntaxBtn'),
    resultList: $('resultList'),
    listNote: $('listNote'),
    filterGroup: $('filterGroup'),
    sortSelect: $('sortSelect'),
    keyBtn: $('keyBtn'),
    keyDot: $('keyDot'),
    keyDialog: $('keyDialog'),
    keyForm: $('keyForm'),
    keyCloseBtn: $('keyCloseBtn'),
    apiKeyInput: $('apiKeyInput'),
    toggleKeyBtn: $('toggleKeyBtn'),
    saveKeyBtn: $('saveKeyBtn'),
    clearKeyBtn: $('clearKeyBtn'),
    keyServerStatus: $('keyServerStatus'),
    keyServerText: $('keyServerText'),
    syntaxBtn: $('syntaxBtn'),
    syntaxDialog: $('syntaxDialog'),
    syntaxCloseBtn: $('syntaxCloseBtn'),
    themeBtn: $('themeBtn'),
    themeIcon: $('themeIcon'),
    toast: $('toast'),
  };

  const state = {
    config: { hasServerKey: false },
    apiKey: readStorage(STORAGE.key) || '',
    query: '',
    results: [],
    elapsed: 0,
    loading: false,
    searched: false,
    error: null,
    filter: 'all',
    sort: 'relevance',
    expanded: new Set(),
    fetching: new Set(),
    fetchErrors: new Map(),
    lastPayload: null,
    pendingQuery: null,
  };

  let searchToken = 0;
  let toastTimer = 0;

  /* ---------------------------------------------------------------------- */
  /* 本地存储与主题                                                          */
  /* ---------------------------------------------------------------------- */
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 隐私模式下可能不可用，静默降级 */
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme, persist = true) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    if (persist) writeStorage(STORAGE.theme, next);

    const use = dom.themeIcon.querySelector('use');
    if (use) use.setAttribute('href', next === 'dark' ? '#i-sun' : '#i-moon');
    dom.themeBtn.setAttribute('aria-label', next === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    dom.themeBtn.title = next === 'dark' ? '切换到浅色模式' : '切换到深色模式';

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#0a0d16' : '#f7f9ff');
  }

  /* ---------------------------------------------------------------------- */
  /* 通用 UI                                                                 */
  /* ---------------------------------------------------------------------- */
  function toast(message, duration = 2800) {
    if (!message) return;
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove('show'), duration);
  }

  function syncDialogLock() {
    const open = document.querySelector('dialog[open]');
    document.body.classList.toggle('is-dialog-open', Boolean(open));
  }

  function openDialog(dialog, focusEl) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    syncDialogLock();
    if (focusEl) window.setTimeout(() => focusEl.focus(), 40);
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    syncDialogLock();
  }

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function charLength(value) {
    return [...value].length;
  }

  /* ---------------------------------------------------------------------- */
  /* 数据请求                                                                */
  /* ---------------------------------------------------------------------- */
  class ApiError extends Error {
    constructor(message, { status = 0, code = '' } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  async function apiPost(path, payload) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (state.apiKey) headers['X-DeepSeek-Key'] = state.apiKey;

      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message =
          (data && data.error && data.error.message) ||
          (response.status === 429
            ? '请求过于频繁，请稍后再试。'
            : `请求失败（HTTP ${response.status}）。`);
        throw new ApiError(message, {
          status: response.status,
          code: (data && data.error && data.error.code) || '',
        });
      }
      if (!data || typeof data !== 'object') {
        throw new ApiError('服务返回了无法解析的响应。', { status: response.status });
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === 'AbortError') {
        throw new ApiError('请求超时，请稍后重试。', { status: 408, code: 'client_timeout' });
      }
      throw new ApiError('无法连接本地服务，请确认终端中的 npm start 仍在运行。', {
        status: 0,
        code: 'network_error',
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 搜索                                                                    */
  /* ---------------------------------------------------------------------- */
  function buildPayload(query) {
    const payload = {
      query,
      count: Number(dom.countInput.value) || 10,
      need_content: Boolean(dom.needContent.checked),
    };
    const ori = dom.oriInput.value.trim();
    if (ori) payload.ori_question = ori;
    const local = dom.localInput.value.trim();
    if (local) payload.localization = local;
    return payload;
  }

  async function runSearch(rawQuery, { addHistory = true } = {}) {
    const query = String(rawQuery ?? '').trim();
    if (!query) {
      toast('请输入搜索词');
      dom.input.focus();
      return;
    }
    if (charLength(query) > MAX_QUERY) {
      toast(`搜索词最多 ${MAX_QUERY} 个字符`);
      return;
    }
    if (!state.config.hasServerKey && !state.apiKey) {
      state.pendingQuery = query;
      toast('请先配置 DeepSeek API Key');
      openKeyDialog();
      return;
    }

    const token = ++searchToken;
    state.query = query;
    state.loading = true;
    state.error = null;
    state.searched = true;
    state.expanded.clear();
    state.fetchErrors.clear();
    state.fetching.clear();

    dom.input.value = query;
    updateCharCount();
    document.body.classList.add('has-searched');
    dom.resultsSection.hidden = false;
    dom.skeletonList.hidden = false;
    dom.errorBox.hidden = true;
    dom.emptyBox.hidden = true;
    dom.resultList.replaceChildren();
    dom.listNote.hidden = true;
    dom.resultCount.textContent = '正在搜索…';
    dom.resultTime.textContent = '';
    setSearching(true);

    const startedAt = performance.now();
    const payload = buildPayload(query);
    state.lastPayload = payload;

    try {
      const data = await apiPost('/api/search', payload);
      if (token !== searchToken) return;

      const list = Array.isArray(data.results) ? data.results : [];
      state.results = list.map(normalizeResult).filter((item) => item && item.url);
      const serverElapsed = Number(data.elapsed_ms);
      state.elapsed = Number.isFinite(serverElapsed) && serverElapsed >= 0
        ? serverElapsed / 1000
        : (performance.now() - startedAt) / 1000;
      state.loading = false;

      if (addHistory) pushHistory(query);
      updateUrl(query);
      renderResults();
    } catch (error) {
      if (token !== searchToken) return;
      state.loading = false;
      state.results = [];
      state.error = error;
      showError(error);
    } finally {
      if (token === searchToken) {
        setSearching(false);
        dom.skeletonList.hidden = true;
      }
    }
  }

  function setSearching(loading) {
    dom.searchBtn.disabled = loading;
    dom.searchBtn.classList.toggle('is-loading', loading);
    dom.searchSpinner.hidden = !loading;
    dom.searchLabel.textContent = loading ? '搜索中' : '搜索';
    dom.input.setAttribute('aria-busy', String(loading));
  }

  function normalizeResult(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      rerank_score: Number(raw.rerank_score) || 0,
      title: typeof raw.title === 'string' ? raw.title : '',
      url: typeof raw.url === 'string' ? raw.url : '',
      snippet: typeof raw.snippet === 'string' ? raw.snippet : '',
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      content: typeof raw.content === 'string' ? raw.content : '',
      site_name: typeof raw.site_name === 'string' ? raw.site_name : '',
      site_icon: typeof raw.site_icon === 'string' ? raw.site_icon : '',
      date: typeof raw.date === 'string' ? raw.date : '',
      authority: Number.isInteger(raw.authority) ? raw.authority : -1,
    };
  }

  const ERROR_TITLES = {
    0: '本地服务不可用',
    400: '请求参数有误',
    401: 'API Key 无效或未配置',
    402: '账户余额不足',
    403: '请求被拒绝',
    404: '页面内容不可用',
    408: '请求超时',
    413: '请求体过大',
    429: '请求过于频繁',
    500: 'DeepSeek 服务异常',
    502: '上游服务不可达',
    504: '上游响应超时',
  };

  function showError(error) {
    const status = error && error.status ? error.status : 0;
    dom.errorTitle.textContent = ERROR_TITLES[status] || '搜索失败';
    dom.errorMessage.textContent = (error && error.message) || '发生未知错误，请稍后重试。';
    dom.errorBox.hidden = false;
    dom.emptyBox.hidden = true;
    dom.resultList.hidden = true;
    dom.resultCount.textContent = '搜索失败';
    dom.resultTime.textContent = '';
    dom.listNote.hidden = true;
    dom.resultsSection.hidden = false;
    dom.skeletonList.hidden = true;
  }

  /* ---------------------------------------------------------------------- */
  /* 渲染结果                                                                */
  /* ---------------------------------------------------------------------- */
  function filteredResults() {
    let list = state.results.slice();

    if (state.filter === 'quality') list = list.filter((item) => item.rerank_score >= 1.5);
    if (state.filter === 'authority') list = list.filter((item) => item.authority >= 3);

    if (state.sort === 'date') {
      list.sort((a, b) => dateValue(b.date) - dateValue(a.date));
    } else if (state.sort === 'authority') {
      list.sort((a, b) => b.authority - a.authority || b.rerank_score - a.rerank_score);
    }

    return list;
  }

  function dateValue(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  function renderResults() {
    const total = state.results.length;
    const visible = filteredResults();
    const filtered = state.filter !== 'all';
    const searching = state.loading;

    dom.resultsSection.hidden = false;
    dom.skeletonList.hidden = true;
    dom.errorBox.hidden = true;
    dom.resultList.hidden = false;
    dom.resultList.replaceChildren();

    if (searching) return;

    if (total === 0) {
      dom.resultCount.textContent = '没有找到结果';
      dom.resultTime.textContent = state.elapsed ? `· 用时 ${state.elapsed.toFixed(2)} 秒` : '';
      dom.emptyTitle.textContent = '没有找到匹配的网页';
      dom.emptyMessage.textContent =
        '试试更宽泛的关键词，或去掉过于严格的 site:、after: 等操作符。也可以开启「返回网页正文」后再试。';
      dom.emptyResetFilterBtn.hidden = true;
      dom.emptyBox.hidden = false;
      dom.resultList.hidden = true;
      dom.listNote.hidden = true;
      return;
    }

    dom.resultCount.textContent = filtered
      ? `显示 ${visible.length} / ${total} 条结果`
      : `找到 ${total} 条结果`;
    dom.resultTime.textContent = `· 用时 ${state.elapsed.toFixed(2)} 秒`;

    if (!visible.length) {
      dom.emptyTitle.textContent = '当前筛选下没有结果';
      dom.emptyMessage.textContent = `共返回 ${total} 条结果，但没有条目满足当前筛选条件。试试放宽筛选。`;
      dom.emptyResetFilterBtn.hidden = false;
      dom.emptyBox.hidden = false;
      dom.resultList.hidden = true;
      dom.listNote.hidden = true;
      return;
    }

    dom.emptyBox.hidden = true;
    dom.resultList.hidden = false;
    const fragment = document.createDocumentFragment();
    visible.forEach((item, index) => fragment.append(buildCard(item, index)));
    dom.resultList.append(fragment);

    dom.listNote.hidden = false;
    dom.listNote.textContent =
      `「优质」= rerank_score ≥ 1.5 · 「权威」= authority ≥ 3` +
      (state.results.length >= 50 ? ' · 已达到单次 50 条上限' : '');
  }

  function buildCard(item, index) {
    const li = el('li', 'result-card');
    li.dataset.url = item.url;
    li.dataset.order = String(index);
    li.style.setProperty('--i', String(Math.min(index, 12)));

    const article = el('article');

    /* 顶部元信息 */
    const top = el('div', 'result-top');
    top.append(buildFavicon(item));

    const siteName = item.site_name || hostOf(item.url) || '未知站点';
    const site = el('span', 'site-name', siteName);
    site.title = siteName;
    top.append(site);

    const parsedDate = item.date ? new Date(item.date) : null;
    if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
      top.append(el('span', 'meta-sep', '·'));
      const time = el('time', 'result-date', formatRelativeDate(parsedDate));
      time.dateTime = item.date;
      time.title = parsedDate.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
      top.append(time);
    }

    const badges = el('span', 'badges');
    if (item.rerank_score >= 1.5) {
      const badge = el('span', 'badge badge-quality');
      badge.append(icon('i-spark'), document.createTextNode('优质'));
      badge.title = `相关度 ${item.rerank_score.toFixed(2)} / 3`;
      badges.append(badge);
    }
    if (item.authority >= 3) {
      const badge = el('span', 'badge badge-authority');
      badge.append(icon('i-shield'), document.createTextNode('权威'));
      badge.title = `权威度 ${item.authority} / 4`;
      badges.append(badge);
    }
    if (parsedDate && Date.now() - parsedDate.getTime() < 7 * 86400000 && Date.now() >= parsedDate.getTime()) {
      const badge = el('span', 'badge badge-fresh', '新');
      badge.title = '7 天内发布';
      badges.append(badge);
    }
    if (badges.childNodes.length) top.append(badges);

    const score = el('span', 'score');
    score.title = `相关度 ${item.rerank_score.toFixed(2)} / 3 · 权威度 ${authorityLabel(item.authority)}`;
    const track = el('span', 'score-track');
    const fill = el('span', 'score-fill');
    fill.style.width = `${Math.max(2, Math.min(100, (item.rerank_score / 3) * 100))}%`;
    track.append(fill);
    score.append(track, el('span', 'score-num', item.rerank_score.toFixed(1)));
    top.append(score);

    /* 标题 */
    const title = el('h3', 'result-title');
    const link = document.createElement('a');
    link.href = safeHref(item.url);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(highlight(item.title || hostOf(item.url) || '未命名结果', state.query));
    link.append(icon('i-external'));
    title.append(link);

    /* 摘要 */
    const snippetText =
      item.snippet || (item.summary ? `${item.summary.slice(0, 180)}…` : '该结果未提供摘要。');
    const snippet = el('p', 'result-snippet');
    snippet.append(highlight(snippetText, state.query));

    /* 操作栏 */
    const actions = el('div', 'result-actions');
    const expanded = state.expanded.has(item.url);

    const detailBtn = actionButton('detail', 'i-chevron', expanded ? '收起' : '详情', expanded);
    detailBtn.querySelector('.icon').classList.add('chev');

    let contentBtn;
    if (item.content) {
      contentBtn = actionButton('content', 'i-doc', '正文', expanded);
    } else if (state.fetching.has(item.url)) {
      contentBtn = actionButton('fetch', 'i-doc', '抓取中…');
      contentBtn.disabled = true;
      contentBtn.replaceChildren(spinner(), document.createTextNode('抓取中…'));
    } else {
      contentBtn = actionButton('fetch', 'i-doc', '抓取正文');
      contentBtn.title = '调用 /v1/tools/fetch 抓取网页正文（按次计费）';
    }

    const copyBtn = actionButton('copy', 'i-copy', '复制链接');
    copyBtn.title = '复制原文链接';

    const openLink = document.createElement('a');
    openLink.className = 'action-btn';
    openLink.href = safeHref(item.url);
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.append(icon('i-arrow'), document.createTextNode('打开'));

    actions.append(detailBtn, contentBtn, copyBtn, openLink);

    const urlText = el('span', 'url-text', pathLabel(item.url));
    urlText.title = item.url;
    actions.append(urlText);

    article.append(top, title, snippet, actions);
    if (expanded) article.append(buildDetail(item));

    li.append(article);
    return li;
  }

  function actionButton(action, iconName, label, active = false) {
    const button = el('button', 'action-btn');
    button.type = 'button';
    button.dataset.act = action;
    button.append(icon(iconName), document.createTextNode(label));
    if (active) button.classList.add('active');
    return button;
  }

  function buildFavicon(item) {
    const wrap = el('span', 'favicon');
    const label = (item.site_name || hostOf(item.url) || '?').trim().charAt(0).toUpperCase();
    const src = item.site_icon;
    if (src && (/^https?:\/\//i.test(src) || /^data:image\//i.test(src))) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        wrap.textContent = label || '·';
      });
      img.src = src;
      wrap.append(img);
    } else {
      wrap.textContent = label || '·';
    }
    return wrap;
  }

  function buildDetail(item) {
    const wrap = el('div', 'result-detail');

    if (item.summary || item.snippet) {
      const block = el('div', 'detail-block');
      block.append(el('p', 'detail-label', '长摘要'));
      const text = el('p', 'detail-text');
      text.append(highlight(item.summary || item.snippet, state.query));
      block.append(text);
      wrap.append(block);
    }

    const contentBlock = el('div', 'detail-block');
    const contentLabel = el('p', 'detail-label');
    if (item.content) {
      contentLabel.textContent = `网页正文 · ${item.content.length.toLocaleString('zh-CN')} 字符`;
      contentBlock.append(contentLabel);
      const pre = el('pre', 'detail-content', item.content);
      contentBlock.append(pre);
    } else if (state.fetching.has(item.url)) {
      const loading = el('div', 'detail-loading');
      loading.append(spinner(), document.createTextNode('正在抓取网页正文…'));
      contentBlock.append(loading);
    } else if (state.fetchErrors.has(item.url)) {
      contentLabel.textContent = '正文抓取失败';
      contentBlock.append(contentLabel, el('p', 'detail-empty', state.fetchErrors.get(item.url)));
    } else {
      contentLabel.textContent = '网页正文';
      contentBlock.append(
        contentLabel,
        el(
          'p',
          'detail-empty',
          '尚未获取正文。搜索时开启「返回网页正文」可一并返回，或点击「抓取正文」按需调用 Fetch 接口。',
        ),
      );
    }
    wrap.append(contentBlock);

    return wrap;
  }

  function authorityLabel(value) {
    if (value < 0) return '未知';
    return `${value} / 4`;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function pathLabel(url) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
      return `${parsed.hostname.replace(/^www\./, '')}${pathname}`;
    } catch {
      return url;
    }
  }

  function safeHref(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '#';
    } catch {
      return '#';
    }
  }

  function formatRelativeDate(date) {
    const diff = Date.now() - date.getTime();
    const day = 86400000;
    if (diff >= 0 && diff < day) return '今天';
    if (diff >= day && diff < 2 * day) return '昨天';
    if (diff >= 2 * day && diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* ---------------------------------------------------------------------- */
  /* 关键词高亮                                                              */
  /* ---------------------------------------------------------------------- */
  function searchTerms(query) {
    const cleaned = String(query || '')
      .replace(/-?(?:site|lang|after|before):[^\s]+/gi, ' ')
      .replace(/(^|\s)-/g, '$1')
      .replace(/["“”]/g, ' ')
      .trim();
    if (!cleaned) return [];
    const words = [...new Set(cleaned.split(/\s+/).filter((word) => charLength(word) >= 2))];
    return words.sort((a, b) => b.length - a.length).slice(0, 6);
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlight(text, query) {
    const value = String(text || '');
    const fragment = document.createDocumentFragment();
    const terms = searchTerms(query);
    if (!terms.length) {
      fragment.append(document.createTextNode(value));
      return fragment;
    }

    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
    let lastIndex = 0;
    let match;
    let guard = 0;
    while ((match = pattern.exec(value)) !== null && guard < 200) {
      guard += 1;
      if (match.index > lastIndex) {
        fragment.append(document.createTextNode(value.slice(lastIndex, match.index)));
      }
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      fragment.append(mark);
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    if (lastIndex < value.length) {
      fragment.append(document.createTextNode(value.slice(lastIndex)));
    }
    return fragment;
  }

  /* ---------------------------------------------------------------------- */
  /* 卡片交互                                                                */
  /* ---------------------------------------------------------------------- */
  function findItem(url) {
    return state.results.find((item) => item.url === url) || null;
  }

  function refreshCard(item) {
    const cards = [...dom.resultList.children].filter((card) => card.dataset.url === item.url);
    for (const card of cards) {
      const order = Number(card.dataset.order || 0);
      const next = buildCard(item, order);
      next.classList.add('no-anim');
      card.replaceWith(next);
    }
  }

  function toggleDetail(url) {
    if (state.expanded.has(url)) state.expanded.delete(url);
    else state.expanded.add(url);
    const item = findItem(url);
    if (item) refreshCard(item);
  }

  async function fetchContent(item) {
    if (!item || state.fetching.has(item.url)) return;
    if (item.content) {
      state.expanded.add(item.url);
      refreshCard(item);
      return;
    }

    state.fetching.add(item.url);
    state.fetchErrors.delete(item.url);
    refreshCard(item);

    try {
      const data = await apiPost('/api/fetch', { url: item.url });
      const content = typeof data.content === 'string' ? data.content : '';
      if (!content.trim()) {
        throw new ApiError('该页面没有可提取的正文内容。', { status: 404, code: 'empty_content' });
      }
      item.content = content;
      state.expanded.add(item.url);
      toast(`已抓取正文 · ${content.length.toLocaleString('zh-CN')} 字符`);
    } catch (error) {
      state.fetchErrors.set(item.url, error.message || '正文抓取失败。');
      state.expanded.add(item.url);
      toast(error.message || '正文抓取失败');
    } finally {
      state.fetching.delete(item.url);
      refreshCard(item);
    }
  }

  function updateCardFromEvent(event) {
    const button = event.target.closest('[data-act]');
    if (!button || !dom.resultList.contains(button)) return;
    const card = button.closest('.result-card');
    if (!card) return;
    const item = findItem(card.dataset.url);
    if (!item) return;

    const action = button.dataset.act;
    if (action === 'detail') {
      toggleDetail(item.url);
    } else if (action === 'content') {
      state.expanded.add(item.url);
      refreshCard(item);
    } else if (action === 'fetch') {
      fetchContent(item);
    } else if (action === 'copy') {
      copyToClipboard(item.url).then((ok) => {
        toast(ok ? '链接已复制' : '复制失败，请手动复制');
      });
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* 回退 */
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 搜索历史                                                                */
  /* ---------------------------------------------------------------------- */
  function loadHistory() {
    try {
      const parsed = JSON.parse(readStorage(STORAGE.history) || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 8) : [];
    } catch {
      return [];
    }
  }

  function pushHistory(query) {
    const history = [query, ...loadHistory().filter((item) => item !== query)].slice(0, 8);
    writeStorage(STORAGE.history, JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const history = loadHistory();
    dom.historyChips.replaceChildren();
    dom.historyRow.hidden = history.length === 0;
    for (const query of history) {
      const chip = el('button', 'history-chip', query);
      chip.type = 'button';
      chip.dataset.history = query;
      chip.title = query;
      dom.historyChips.append(chip);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* URL / 偏好                                                              */
  /* ---------------------------------------------------------------------- */
  function updateUrl(query) {
    try {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set('q', query);
      else url.searchParams.delete('q');
      window.history.replaceState({}, '', url);
    } catch {
      /* ignore */
    }
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(readStorage(STORAGE.prefs) || '{}');
      const count = Number(prefs.count);
      if (Number.isInteger(count) && count >= 1 && count <= 50) {
        dom.countInput.value = String(count);
      }
      dom.needContent.checked = Boolean(prefs.needContent);
    } catch {
      /* ignore */
    }
    updateCountOutput();
  }

  function savePrefs() {
    writeStorage(
      STORAGE.prefs,
      JSON.stringify({
        count: Number(dom.countInput.value) || 10,
        needContent: Boolean(dom.needContent.checked),
      }),
    );
  }

  function updateCountOutput() {
    dom.countOut.textContent = dom.countInput.value;
  }

  function updateCharCount() {
    const length = charLength(dom.input.value);
    dom.charCount.textContent = `${length}/${MAX_QUERY}`;
    dom.charCount.classList.toggle('visible', length > 0);
    dom.charCount.classList.toggle('limit', length >= MAX_QUERY - 8);
    dom.clearBtn.hidden = length === 0;
  }

  /* ---------------------------------------------------------------------- */
  /* API Key                                                                 */
  /* ---------------------------------------------------------------------- */
  function updateKeyIndicators() {
    const hasKey = Boolean(state.config.hasServerKey || state.apiKey);
    dom.keyDot.dataset.state = hasKey ? 'on' : 'off';
    dom.keyBtn.title = hasKey
      ? state.apiKey
        ? '已配置浏览器 API Key'
        : '已使用服务端配置的 API Key'
      : '尚未配置 API Key';

    if (state.config.hasServerKey) {
      dom.keyServerStatus.dataset.state = 'on';
      dom.keyServerText.textContent =
        '服务端已配置 API Key，可直接搜索。下方填写的 Key 会优先于服务端配置。';
    } else {
      dom.keyServerStatus.dataset.state = 'off';
      dom.keyServerText.textContent = '尚未配置 API Key。请在下方填写，或在 .env 中设置 DEEPSEEK_API_KEY。';
    }
  }

  function openKeyDialog() {
    updateKeyIndicators();
    dom.apiKeyInput.value = state.apiKey;
    dom.apiKeyInput.type = 'password';
    const use = dom.toggleKeyBtn.querySelector('use');
    if (use) use.setAttribute('href', '#i-eye');
    openDialog(dom.keyDialog, dom.apiKeyInput);
  }

  function saveKeyFromInput() {
    const value = dom.apiKeyInput.value.trim().replace(/^Bearer\s+/i, '');
    if (!value) {
      if (state.config.hasServerKey) {
        state.apiKey = '';
        removeStorage(STORAGE.key);
        updateKeyIndicators();
        toast('已清除浏览器 Key，将使用服务端配置');
        closeDialog(dom.keyDialog);
      } else {
        toast('请输入有效的 API Key');
        dom.apiKeyInput.focus();
      }
      return;
    }
    if (value.length < 8) {
      toast('API Key 看起来太短，请检查后重试');
      dom.apiKeyInput.focus();
      return;
    }
    state.apiKey = value;
    writeStorage(STORAGE.key, value);
    updateKeyIndicators();
    const pending = state.pendingQuery;
    state.pendingQuery = null;
    closeDialog(dom.keyDialog);
    if (pending) {
      toast('API Key 已保存，正在搜索…');
      runSearch(pending);
    } else {
      toast('API Key 已保存，开始搜索吧');
      dom.input.focus();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 事件绑定                                                                */
  /* ---------------------------------------------------------------------- */
  function bindEvents() {
    dom.form.addEventListener('submit', (event) => {
      event.preventDefault();
      runSearch(dom.input.value);
    });

    dom.input.addEventListener('input', updateCharCount);
    dom.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dom.input.value) {
        dom.input.value = '';
        updateCharCount();
      }
    });

    dom.clearBtn.addEventListener('click', () => {
      dom.input.value = '';
      updateCharCount();
      dom.input.focus();
    });

    dom.quickRow.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-q]');
      if (!chip) return;
      dom.input.value = chip.dataset.q;
      updateCharCount();
      runSearch(chip.dataset.q);
    });

    dom.advToggle.addEventListener('click', () => {
      const expanded = dom.advToggle.getAttribute('aria-expanded') === 'true';
      dom.advToggle.setAttribute('aria-expanded', String(!expanded));
      dom.advPanel.hidden = expanded;
    });

    dom.countInput.addEventListener('input', () => {
      updateCountOutput();
      savePrefs();
    });
    dom.needContent.addEventListener('change', savePrefs);

    dom.filterGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      state.filter = button.dataset.filter;
      for (const item of dom.filterGroup.querySelectorAll('button')) {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      }
      renderResults();
    });

    dom.sortSelect.addEventListener('change', () => {
      state.sort = dom.sortSelect.value;
      renderResults();
    });

    dom.resultList.addEventListener('click', updateCardFromEvent);

    dom.retryBtn.addEventListener('click', () => {
      if (state.lastPayload && state.lastPayload.query) runSearch(state.lastPayload.query, { addHistory: false });
    });

    dom.errorKeyBtn.addEventListener('click', openKeyDialog);

    dom.emptyResetFilterBtn.addEventListener('click', () => {
      state.filter = 'all';
      for (const item of dom.filterGroup.querySelectorAll('button')) {
        const active = item.dataset.filter === 'all';
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      }
      renderResults();
    });

    dom.emptySyntaxBtn.addEventListener('click', () => openDialog(dom.syntaxDialog));

    dom.historyChips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-history]');
      if (!chip) return;
      dom.input.value = chip.dataset.history;
      updateCharCount();
      runSearch(chip.dataset.history);
    });

    dom.clearHistoryBtn.addEventListener('click', () => {
      removeStorage(STORAGE.history);
      renderHistory();
      toast('搜索历史已清空');
    });

    dom.keyBtn.addEventListener('click', openKeyDialog);
    dom.keyCloseBtn.addEventListener('click', () => closeDialog(dom.keyDialog));
    dom.keyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveKeyFromInput();
    });
    dom.clearKeyBtn.addEventListener('click', () => {
      state.apiKey = '';
      removeStorage(STORAGE.key);
      dom.apiKeyInput.value = '';
      updateKeyIndicators();
      toast('浏览器中的 API Key 已清除');
    });
    dom.toggleKeyBtn.addEventListener('click', () => {
      const show = dom.apiKeyInput.type === 'password';
      dom.apiKeyInput.type = show ? 'text' : 'password';
      const use = dom.toggleKeyBtn.querySelector('use');
      if (use) use.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
      dom.toggleKeyBtn.setAttribute('aria-label', show ? '隐藏 API Key' : '显示 API Key');
    });

    dom.syntaxBtn.addEventListener('click', () => openDialog(dom.syntaxDialog));
    dom.syntaxCloseBtn.addEventListener('click', () => closeDialog(dom.syntaxDialog));
    dom.syntaxDialog.addEventListener('click', (event) => {
      const example = event.target.closest('[data-syntax]');
      if (!example) return;
      dom.input.value = example.dataset.syntax;
      updateCharCount();
      closeDialog(dom.syntaxDialog);
      dom.input.focus();
      toast('已填入搜索词，按 Enter 开始搜索');
    });

    dom.themeBtn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });

    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener('close', () => {
        if (dialog === dom.keyDialog) state.pendingQuery = null;
        syncDialogLock();
      });
      dialog.addEventListener('cancel', () => window.setTimeout(syncDialogLock, 0));
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && !isTyping(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (document.querySelector('dialog[open]')) return;
        event.preventDefault();
        dom.input.focus();
        dom.input.select();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open]')) return;
        event.preventDefault();
        dom.input.focus();
      }
    });

    const onScroll = () => dom.siteHeader.classList.toggle('scrolled', window.scrollY > 6);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    window.addEventListener('popstate', () => {
      const query = new URLSearchParams(window.location.search).get('q') || '';
      if (query) {
        dom.input.value = query;
        updateCharCount();
        runSearch(query, { addHistory: false });
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 初始化                                                                  */
  /* ---------------------------------------------------------------------- */
  async function loadConfig() {
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      state.config = {
        hasServerKey: Boolean(config.hasServerKey),
        maxCount: Number(config.maxCount) || 50,
        docsUrl: typeof config.docsUrl === 'string' ? config.docsUrl : '',
        guideUrl: typeof config.guideUrl === 'string' ? config.guideUrl : '',
      };
      if (state.config.guideUrl) dom.errorDocsLink.href = state.config.guideUrl;
    } catch {
      state.config = { hasServerKey: false };
      toast('无法读取本地服务配置，请确认 npm start 已启动');
    }
    updateKeyIndicators();
  }

  async function init() {
    applyTheme(currentTheme(), false);
    loadPrefs();
    updateCharCount();
    renderHistory();
    bindEvents();

    await loadConfig();

    const params = new URLSearchParams(window.location.search);
    const initialQuery = (params.get('q') || '').trim();
    if (initialQuery) {
      dom.input.value = initialQuery;
      updateCharCount();
      document.body.classList.add('has-searched');
      await runSearch(initialQuery, { addHistory: false });
      return;
    }

    if (!state.apiKey && !state.config.hasServerKey) {
      try {
        if (!sessionStorage.getItem(STORAGE.hint)) {
          sessionStorage.setItem(STORAGE.hint, '1');
          window.setTimeout(() => {
            toast('尚未配置 API Key：点击右上角「API Key」即可开始搜索', 4200);
          }, 900);
        }
      } catch {
        /* ignore */
      }
    }
  }

  init();
})();
