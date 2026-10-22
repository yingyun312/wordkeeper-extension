import { definitionOf, levelOf, notesOf, topicOf, type Article, type Entry } from './core';

type DocumentOptions = { mode: 'bilingual' | 'worksheet' | 'reading'; translations: boolean; answers: boolean; sources: boolean; englishDefinition?: boolean; context?: boolean; notes?: boolean };
const cleanMarkdown = (text: string): string => text.replace(/^\s*```(?:json|markdown|md|text)?\s*/i, '').replace(/\s*```\s*$/, '').replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/\*{1,3}/g, '').replace(/`/g, '');
const escapeHTML = (text: string): string => cleanMarkdown(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const paragraph = (text: string, className = '') => `<p class="${className}">${escapeHTML(text)}</p>`;

function source(entry: Entry): string {
  try {
    const url = new URL(entry.sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return `<p class="source">来源：<a href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(entry.sourceTitle || url.href)}</a></p>`;
  } catch { return ''; }
}

/** Worksheet translations are answers, so they appear only in the answer section. */
export function buildDocument(entries: Entry[], articles: Article[], options: DocumentOptions): string {
  const worksheet = options.mode === 'worksheet';
  const title = { bilingual: '双语学习资料', worksheet: '英语练习册', reading: '英语阅读资料' }[options.mode];
  const blanks = '<div class="writing-space" aria-label="作答区域"></div>';
  const showDefinition = options.englishDefinition !== false;
  const showContext = options.context !== false;
  const showNotes = options.notes !== false;
  const entryHTML = options.mode === 'reading' ? '' : entries.map((entry, index) => {
    const definition = definitionOf(entry); const notes = notesOf(entry);
    return `<section class="entry">
<h3>${index + 1}. ${escapeHTML(entry.text)}</h3>
${entry.type !== 'sentence' && entry.phonetic?.trim() ? paragraph(`/${escapeHTML(entry.phonetic.trim())}/`, 'phonetic') : ''}
${paragraph(`${levelOf(entry).level}${levelOf(entry).estimated ? '（估算）' : ''}${topicOf(entry) ? ' · ' + escapeHTML(topicOf(entry)) : ''}`, 'classification')}
${worksheet ? paragraph('请写出中文释义。') + blanks : (showDefinition && definition ? paragraph(definition, 'english-definition') : '') + (options.translations ? paragraph(entry.translation, 'translation') : '') + (showContext && entry.context ? paragraph(entry.context) : '') + (showNotes && notes ? paragraph(notes, 'notes') : '')}
${!worksheet && entry.tags.length ? paragraph(entry.tags.join(' · '), 'tags') : ''}
${options.sources ? source(entry) : ''}</section>`;
  }).join('');
  const glossary = options.mode === 'reading' && entries.length ? `<section class="glossary"><h2>目标词释义</h2>${entries.map((entry, index) => `<section class="entry"><h3>${index + 1}. ${escapeHTML(entry.text)}</h3>${entry.type !== 'sentence' && entry.phonetic?.trim() ? paragraph(`/${escapeHTML(entry.phonetic.trim())}/`, 'phonetic') : ''}${paragraph(`${levelOf(entry).level}${levelOf(entry).estimated ? '（估算）' : ''}${topicOf(entry) ? ' · ' + escapeHTML(topicOf(entry)) : ''}`, 'classification')}${showDefinition && definitionOf(entry) ? paragraph(definitionOf(entry), 'english-definition') : ''}${options.translations ? paragraph(entry.translation, 'translation') : ''}</section>`).join('')}</section>` : '';
  const articleHTML = articles.map((article, index) => `<article>
<h2>${index + 1}. ${escapeHTML(article.title)}</h2>
${article.targets.length ? paragraph(`学习目标：${article.targets.join(' · ')}`, 'targets') : ''}
${article.paragraphs.map(p => paragraph(p.en) + (!worksheet && options.translations ? paragraph(p.zh, 'translation') : '')).join('')}
${glossary}
${article.questions.length ? '<h3>阅读理解</h3>' : ''}
${article.questions.map((q, i) => `<section class="question">${paragraph(`${i + 1}. ${q.question}`)}${blanks}</section>`).join('')}
</article>`).join('');
  const entryAnswers = worksheet ? entries.map((e, i) => {
    const parts = [showDefinition && definitionOf(e) ? definitionOf(e) : '', options.translations ? e.translation : '', showContext && e.context ? e.context : '', showNotes && notesOf(e) ? notesOf(e) : ''].filter(Boolean);
    return paragraph(`${i + 1}. ${e.text}${parts.length ? ' — ' + parts.join('；') : ''}`);
  }).join('') : '';
  const articleAnswers = articles.filter(a => a.questions.length).map(a => `<h3>${escapeHTML(a.title)}</h3>${a.questions.map((q, i) => paragraph(`${i + 1}. ${q.answer}`)).join('')}`).join('');
  const answers = options.answers && (entryAnswers || articleAnswers) ? `<section class="answer-key"><h2>参考答案</h2>${entryAnswers}${articleAnswers}</section>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title}</title><style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 178mm; padding: 8mm; color: #17202a; background: white; font: 12pt/1.7 Arial, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', SimSun, sans-serif; overflow-wrap: anywhere; }
h1 { font-size: 24pt; } h2 { font-size: 18pt; } h3 { font-size: 13pt; }
h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
p { white-space: pre-wrap; orphans: 3; widows: 3; }
article, .entry { margin-bottom: 10mm; }
.translation, .notes, .tags, .source { color: #454545; }
.classification { color: #6b7d6d; font-size: 9pt; margin: 0 0 2mm; }
.phonetic { color: #7a6847; font-size: 10pt; margin: 0 0 1mm; font-family: 'SF Mono', Menlo, Consolas, monospace; }
.english-definition { color: #33453b; }
.glossary { margin-top: 6mm; }
a { color: inherit; text-decoration: underline; }
.writing-space { height: 30mm; margin: 4mm 0 8mm; border-bottom: 1px solid #999; break-inside: avoid; }
.answer-key { break-before: page; page-break-before: always; }
.print-hint { padding: 3mm; border: 1px solid #ccc; font-size: 10pt; }
@media print { body { max-width: none; padding: 0; color: black; } .print-hint { display: none; } }
</style></head><body><aside class="print-hint">按 Ctrl+P（Mac：⌘P）打印或另存为 PDF，纸张请选择 A4。</aside>
<main><h1>${title}</h1>${entryHTML}${articleHTML}${!entryHTML && !articleHTML ? paragraph('暂无学习内容。') : ''}${answers}</main></body></html>`;
}

export function downloadFile(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Pass only trusted HTML produced by buildDocument, never arbitrary external HTML. */
export function openPrintDocument(html: string): void {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('打印窗口被拦截，请允许弹出窗口后重试。');
  popup.opener = null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  // The visible Ctrl+P hint avoids automatic print timing and popup lifecycle issues.
}
