// Floating selection action. The UI is isolated so page styles cannot alter it.
// Remove buttons left behind by older builds or a duplicated extension install.
for (const id of ['english-study-selection-host', 'shiyu-wordkeeper-selection-host']) document.getElementById(id)?.remove();
const host = document.createElement('div');
host.id = 'shiyu-wordkeeper-selection-host';
const shadow = host.attachShadow({ mode: 'closed' });
const style = document.createElement('style');
style.textContent = `:host{all:initial;position:fixed;z-index:2147483647}button{font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;background:#243b32;border:0;border-radius:8px;padding:9px 13px;box-shadow:0 4px 16px #0004;cursor:pointer}button:disabled{opacity:.65;cursor:wait}`;
shadow.append(style);
const button = document.createElement('button');
button.textContent = '收藏并翻译';
try { button.title = `拾语 v${chrome.runtime.getManifest().version}`; } catch { /* Preview or stale context. */ }
shadow.append(button);
document.documentElement.append(host);
let selectedText = '';
let selectedContext = '';
let hideTimer: number | undefined;
let saving = false;

// Zero-width characters and unpaired surrogates from rich editors can break message serialization.
function sanitize(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').trim();
}
function currentSelection(): { text: string; context: string } | null {
  const selection = window.getSelection();
  const text = sanitize(selection?.toString() || '');
  if (!text || text.length > 10000) return null;
  const node = selection?.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
  const context = sanitize(element?.closest('p,li,blockquote,article')?.textContent || element?.textContent || '').slice(0, 2000);
  return { text, context };
}
function hide(): void { host.style.display = 'none'; }
function scheduleHide(delay: number): void {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, delay);
}
// Every new selection starts a fresh attempt; a finished save must not leave the button locked.
function resetButton(): void {
  button.disabled = false;
  button.textContent = '收藏并翻译';
  try { button.title = `拾语 v${chrome.runtime.getManifest().version}`; } catch { button.title = ''; }
}
function show(selection: { text: string; context: string }): void {
  const changed = selection.text !== selectedText;
  selectedText = selection.text; selectedContext = selection.context;
  // A new piece of text starts a fresh attempt; repeating the same selection keeps the last result.
  if (changed && !saving) resetButton();
  const range = window.getSelection()?.getRangeAt(0);
  if (!range) return;
  const rect = range.getBoundingClientRect();
  host.style.left = `${Math.max(8, Math.min(window.innerWidth - 150, rect.left))}px`;
  host.style.top = `${Math.max(8, rect.bottom + 8)}px`;
  host.style.display = 'block';
  scheduleHide(8000);
}
document.addEventListener('selectionchange', () => {
  window.setTimeout(() => { const selection = currentSelection(); if (selection) show(selection); else hide(); }, 0);
});
button.addEventListener('mousedown', event => event.preventDefault());
button.addEventListener('click', async () => {
  if (!selectedText || button.disabled || saving) return;
  saving = true;
  button.disabled = true;
  button.textContent = '正在保存…';
  button.title = '';
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('扩展已更新，请刷新网页');
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: 'save-and-translate', text: selectedText, context: selectedContext, sourceUrl: location.href, sourceTitle: document.title }),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error('后台未响应，请刷新扩展后重试')), 12000)),
    ]);
    if (!response?.ok || !response.entry?.id) throw new Error(typeof response?.error === 'string' ? response.error : '收藏失败');
    button.textContent = '已收藏 · 正在翻译';
    scheduleHide(1600);
  } catch (error) {
    const raw = error instanceof Error ? error.message : '收藏失败';
    const message = /context invalidated|receiving end does not exist/i.test(raw) ? '扩展已更新，请刷新网页' : raw;
    console.warn('[拾语] 收藏失败：', message);
    button.disabled = false;
    button.textContent = message.includes('重复') ? '已在学习库中' : message.includes('刷新网页') ? message : `失败：${message.slice(0, 16)}`;
    button.title = `${message}（点击重试）`;
  } finally {
    saving = false;
  }
});
hide();
