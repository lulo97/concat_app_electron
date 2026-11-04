const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitCsv = (v = '') => String(v).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const toInt = (v, def, min = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, n) : def;
};
const pad = (n) => String(n).padStart(2, '0');
const formatTimestamp = (d) =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const formatBytes = (b) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(2)} KB` : `${(b / 1048576).toFixed(2)} MB`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

module.exports = { escapeHtml, escapeRegex, splitCsv, toInt, formatTimestamp, formatBytes, tick, debounce };
