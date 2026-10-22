import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Article, Entry } from './core';
import { buildDocument, downloadFile, openPrintDocument } from './export';

const entry: Entry = { id: '1', text: 'apple', englishDefinition: 'a round fruit', translation: '苹果', context: 'An apple.', type: 'word', tags: ['fruit'], notes: 'note', sourceUrl: 'https://example.com/?a=1&b=2', sourceTitle: 'Source', createdAt: 0, due: 0, interval: 0 };
const article: Article = { id: 'a', title: 'Reading title', paragraphs: [{ en: 'English paragraph', zh: '中文段落' }], questions: [{ question: 'What fruit?', answer: 'ANSWER_SECRET' }], targets: ['apple'], createdAt: 0 };
const options = { mode: 'bilingual' as const, translations: true, answers: false, sources: true };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('buildDocument', () => {
  it('escapes every displayed untrusted field and adds no executable markup', () => {
    const attack = `<script>alert("x")</script><img src=x onerror='bad()'>&`;
    const escaped = '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=&#39;bad()&#39;&gt;&amp;';
    const html = buildDocument([{ ...entry, text: attack, translation: attack, context: attack, notes: attack, tags: [attack], sourceTitle: attack }], [{ ...article, title: attack, paragraphs: [{ en: attack, zh: attack }], targets: [attack], questions: [{ question: attack, answer: attack }] }], { ...options, answers: true });
    expect(html.split(escaped).length - 1).toBe(13);
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>bad()</script>', 'file:///tmp/a', '//example.com', '/relative', 'https://user:pass@example.com', 'not a URL'])('does not link unsafe source %s', sourceUrl => {
    expect(buildDocument([{ ...entry, sourceUrl }], [], options)).not.toContain('<a ');
  });

  it.each(['http://example.com', 'https://example.com'])('accepts safe source %s', sourceUrl => {
    expect(buildDocument([{ ...entry, sourceUrl }], [], options)).toContain('<a href=');
  });

  it('honors source and translation switches', () => {
    const html = buildDocument([entry], [article], { ...options, sources: false, translations: false });
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('苹果');
    expect(html).not.toContain('中文段落');
    expect(html).toContain('English paragraph');
  });

  it.each(['bilingual', 'worksheet', 'reading'] as const)('gates answers in %s and puts them on a separate page', mode => {
    const hidden = buildDocument([entry], [article], { ...options, mode });
    expect(hidden).not.toContain('ANSWER_SECRET');
    expect(hidden).not.toContain('<section class="answer-key">');
    const visible = buildDocument([entry], [article], { ...options, mode, answers: true });
    expect(visible).toContain('ANSWER_SECRET');
    expect(visible).toContain('<section class="answer-key">');
    expect(visible).toContain('break-before: page');
  });

  it('renders bilingual content and a complete offline A4 document', () => {
    const html = buildDocument([entry], [article], options);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toMatch(/<\/body><\/html>$/);
    for (const text of ['双语学习资料', '苹果', '中文段落', '@media print', 'size: A4', 'PingFang SC', 'Microsoft YaHei', 'Ctrl+P']) expect(html).toContain(text);
    expect(html).not.toMatch(/<script|<link|@import|url\(/i);
    expect(html).not.toMatch(/height:\s*297mm/);
  });

  it('leaves worksheet space without leaking translations or notes into prompts', () => {
    const html = buildDocument([entry], [article], { ...options, mode: 'worksheet', answers: true });
    const prompts = html.split('<section class="answer-key">')[0];
    expect(prompts).toContain('英语练习册');
    expect(prompts).toContain('class="writing-space"');
    expect(prompts).not.toContain('苹果');
    expect(prompts).not.toContain('中文段落');
    expect(prompts).not.toContain('An apple.');
    expect(html).toContain('苹果');
  });

  it('reading template includes target word definitions alongside the article', () => {
    const html = buildDocument([{ ...entry, text: 'ENTRY_ONLY' }], [article], { ...options, mode: 'reading' });
    expect(html).toContain('英语阅读资料');
    expect(html).toContain('Reading title');
    expect(html).toContain('目标词释义');
    expect(html).toContain('ENTRY_ONLY');
    expect(html).toContain('a round fruit');
    expect(html).toContain('苹果');
    const hidden = buildDocument([entry], [article], { ...options, mode: 'reading', englishDefinition: false, translations: false });
    expect(hidden).not.toContain('a round fruit');
    expect(hidden).not.toContain('苹果');
    expect(buildDocument([], [], { ...options, answers: true })).toContain('暂无学习内容。');
    expect(buildDocument([], [], { ...options, answers: true })).not.toContain('<section class="answer-key">');
  });

  it('strips markdown emphasis, backticks and heading markers from every field', () => {
    const html = buildDocument([{ ...entry, englishDefinition: '**bold** definition', translation: '`code` 苹果', context: '## heading\n- bullet', notes: '*star* text' }], [], options);
    expect(html).not.toContain('**');
    expect(html).not.toContain('`');
    expect(html).not.toContain('##');
    expect(html).toContain('bold definition');
    expect(html).toContain('code 苹果');
    expect(html).toContain('star text');
  });

  it('gates english definitions, context and notes independently', () => {
    const noted = { ...entry, notes: 'MY_NOTE' };
    expect(buildDocument([noted], [], options)).toContain('a round fruit');
    expect(buildDocument([noted], [], options)).toContain('An apple.');
    expect(buildDocument([noted], [], options)).toContain('MY_NOTE');
    expect(buildDocument([noted], [], { ...options, englishDefinition: false })).not.toContain('a round fruit');
    expect(buildDocument([noted], [], { ...options, context: false })).not.toContain('An apple.');
    expect(buildDocument([noted], [], { ...options, notes: false })).not.toContain('MY_NOTE');
  });

  it('hides worksheet answer fields that are switched off', () => {
    const noted = { ...entry, notes: 'MY_NOTE' };
    const html = buildDocument([noted], [], { ...options, mode: 'worksheet', answers: true, translations: false, englishDefinition: false, context: false, notes: false });
    const answers = html.split('<section class="answer-key">')[1];
    expect(answers).toContain('apple');
    expect(answers).not.toContain('a round fruit');
    expect(answers).not.toContain('苹果');
    expect(answers).not.toContain('An apple.');
    expect(answers).not.toContain('MY_NOTE');
  });
});

describe('browser helpers without browser automation', () => {
  it('downloads a Blob and revokes its URL only after a delay', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
    downloadFile('study.html', '你好', 'text/html;charset=utf-8');
    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
    expect(await blob.text()).toBe('你好');
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(anchor.download).toBe('study.html');
    expect(anchor.href).toBe('blob:test');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('opens the generated document without adding scripts', () => {
    const popup = { opener: {}, document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('window', { open });
    const html = buildDocument([], [], options);
    openPrintDocument(html);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(popup.opener).toBeNull();
    expect(popup.document.write).toHaveBeenCalledExactlyOnceWith(html);
    expect(popup.document.close).toHaveBeenCalledOnce();
  });

  it('reports blocked popups', () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    expect(() => openPrintDocument('')).toThrow('允许弹出窗口');
  });
});
