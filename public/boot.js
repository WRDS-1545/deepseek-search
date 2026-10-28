/* 在样式表加载前应用主题，避免深色模式闪白。 */
(() => {
  try {
    const saved = localStorage.getItem('ds-search:theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved === 'dark' || saved === 'light' ? saved : prefersDark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
