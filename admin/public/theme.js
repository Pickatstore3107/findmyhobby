// Applies the saved light/dark theme before the first paint, so there is no flash.
try {
  var t = localStorage.getItem('fmh.theme');
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: the default light theme applies */ }
