// @vitest-environment jsdom
// DOM-level UI unit tests, not browser end-to-end verification.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Article, Entry, Settings} from './core';
import type {Root} from 'react-dom/client';

const state = vi.hoisted(() => ({
  entries: [] as Entry[],
  articles: [] as Article[],
  root: null as Root | null,
  settings: {baseUrl: 'https://api.example.com/v1', model: 'test-model', key: '', remember: false} as Settings,
}));

vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    state.root = actual.createRoot(...args);
    return state.root;
  }};
});
vi.mock('./core', async importOriginal => {
  const actual = await importOriginal<typeof import('./core')>();
  return {
    ...actual,
    listEntries: vi.fn(async () => structuredClone(state.entries)),
    listArticles: vi.fn(async () => structuredClone(state.articles)),
    saveEntry: vi.fn(async (entry: Entry) => {
      state.entries = [...state.entries.filter(e => e.id !== entry.id), structuredClone(entry)];
    }),
    saveArticle: vi.fn(async (article: Article) => { state.articles.push(structuredClone(article)); }),
    getSettings: vi.fn(async () => ({...state.settings})),
    saveSettings: vi.fn(async (settings: Settings) => { state.settings = {...settings}; }),
    callAI: vi.fn< (prompt: string) => Promise<string> >(),
    exportBackup: vi.fn(async () => JSON.stringify({version: 1, entries: state.entries, articles: state.articles})),
  };
});
vi.mock('./export', async importOriginal => {
  const actual = await importOriginal<typeof import('./export')>();
  return {...actual, buildDocument: vi.fn(actual.buildDocument), downloadFile: vi.fn(), openPrintDocument: vi.fn()};
});

let act: typeof import('react')['act'];
let core: typeof import('./core');
let exports: typeof import('./export');
function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function field(text: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const result = [...document.querySelectorAll('label')].find(l => l.textContent?.includes(text))?.querySelector('input, textarea, select');
  if (!result) throw new Error(`Missing field: ${text}`);
  return result as ReturnType<typeof field>;
}
async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}
async function fill(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    // Use the native setter so React's value tracker sees a real input change.
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {bubbles: true}));
  });
}
async function mountWith(entries: Entry[]) {
  await act(async () => { state.root?.unmount(); });
  state.root = null;
  vi.resetModules();
  ({act} = await import('react'));
  core = await import('./core');
  exports = await import('./export');
  vi.mocked(core.callAI).mockReset();
  state.entries = entries;
  state.articles = [];
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('./main'); });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('confirm', vi.fn(() => true));
  ({act} = await import('react'));
  core = await import('./core');
  exports = await import('./export');
  vi.mocked(core.callAI).mockReset();
  state.settings = {baseUrl: 'https://api.example.com/v1', model: 'test-model', key: '', remember: false};
  state.entries = [{...core.newEntry('resilient'), id: 'seed-entry', translation: '有韧性的', context: 'She is resilient.', due: Date.now() - 1000}];
  state.articles = [];
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('./main'); });
});
afterEach(async () => {
  await act(async () => { state.root?.unmount(); });
  state.root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('App DOM UI unit tests', () => {
  it('adds a collection entry and renders saved values after refresh', async () => {
    await click(button('添加词句'));
    await fill(field('英文原文'), 'keep going');
    await fill(field('中文释义'), '继续前进');
    await fill(field('类型'), 'idiom');
    await fill(field('标签'), 'daily,motivation');
    await click(button('保存到学习库'));
    expect(core.saveEntry).toHaveBeenCalledWith(expect.objectContaining({text: 'keep going', translation: '继续前进', type: 'idiom', tags: ['daily', 'motivation']}));
    expect(document.querySelector('.modal')).toBeNull();
    const saved = [...document.querySelectorAll('.entry')].find(e => e.textContent?.includes('keep going'));
    expect(saved?.textContent).toContain('继续前进');
    expect(saved?.textContent).toContain('#daily #motivation');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('词句已保存');
  });

  it.each([
    ['忘记 · 10 分钟后', 0, 600000],
    ['模糊 · 稍后再练', 1, 86400000],
    ['记住 · 延长间隔', 1, 86400000],
  ] as const)('reveals the review answer and persists rating %s', async (rating, interval, delay) => {
    await click(button('今日复习'));
    expect(document.querySelector('.answer')).toBeNull();
    expect(document.querySelector('.review h2')?.textContent).toBe('resilient');
    await click(button('查看参考答案'));
    expect(document.querySelector('.answer')?.textContent).toContain('有韧性的');
    const before = Date.now();
    await click(button(rating));
    expect(core.saveEntry).toHaveBeenCalledOnce();
    const saved = vi.mocked(core.saveEntry).mock.calls[0][0];
    expect(saved.id).toBe('seed-entry');
    expect(saved.interval).toBe(interval);
    expect(saved.due).toBeGreaterThanOrEqual(before + delay);
    expect(saved.due).toBeLessThanOrEqual(Date.now() + delay);
    expect(document.body.textContent).toContain('当前复习已完成');
    expect(document.querySelector('.answer')).toBeNull();
  });

  it('generates and saves structured reading with highlights, translation and answers', async () => {
    const generated = {title: 'A New Start', paragraphs: [{en: 'She is resilient.', zh: '她很有韧性。'}], questions: [
      {question: 'Who is resilient?', answer: 'The girl.'},
      {question: 'What is she like?', answer: 'She does not give up.'},
      {question: 'What is the theme?', answer: 'Persistence.'},
    ]};
    vi.mocked(core.callAI).mockResolvedValue(JSON.stringify(generated));
    await click(document.querySelector<HTMLInputElement>('[aria-label="选择 resilient"]')!);
    await click(button('阅读训练'));
    await click(button('生成专属短文'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(core.callAI).toHaveBeenCalledWith(expect.stringContaining('["resilient"]'));
    expect(core.saveArticle).toHaveBeenCalledWith(expect.objectContaining({...generated, targets: ['resilient']}));
    expect(document.querySelector('.reading h2')?.textContent).toBe('A New Start');
    expect(document.querySelector('.reading mark')?.textContent).toBe('resilient');
    expect(document.querySelector('.translation')?.textContent).toBe('她很有韧性。');
    expect(document.querySelectorAll('.reading textarea')).toHaveLength(3);
    expect(document.querySelector('.reading .answer')).toBeNull();
    await click(button('查看参考答案'));
    expect(document.querySelector('.reading .answer')?.textContent).toBe('The girl.');
    await click(field('中文译文'));
    expect(document.querySelector('.translation')).toBeNull();
    expect(document.querySelector('[aria-label="已保存文章"]')?.textContent).toContain('A New Start');
  });

  it('saves edited service settings and exposes the JSON backup action', async () => {
    await click(button('设置'));
    await fill(field('Base URL'), 'https://service.example/v1');
    await fill(field('模型名称'), 'custom-model');
    await fill(field('API Key'), 'unit-test-key');
    await click(field('在此设备记住密钥'));
    await click(button('保存并授权服务'));
    expect(core.saveSettings).toHaveBeenCalledWith({baseUrl: 'https://service.example/v1', model: 'custom-model', key: 'unit-test-key', remember: true});
    expect(document.querySelector('[role="status"]')?.textContent).toContain('设置已保存');
    await click(button('导出 JSON 备份'));
    expect(core.exportBackup).toHaveBeenCalledOnce();
    expect(exports.downloadFile).toHaveBeenCalledWith('拾语备份.json', expect.any(String), 'application/json');
    const backup = JSON.parse(vi.mocked(exports.downloadFile).mock.calls[0][1]);
    expect(backup.entries[0].text).toBe('resilient');
    expect(JSON.stringify(backup)).not.toContain('unit-test-key');
  });

  it('connects HTML download and print/PDF entry points to document generation', async () => {
    await click(button('导出资料'));
    await click(button('下载 HTML'));
    expect(exports.buildDocument).toHaveBeenCalledWith(state.entries, [], {mode: 'bilingual', translations: true, answers: true, sources: true, englishDefinition: true, context: true, notes: true});
    expect(exports.downloadFile).toHaveBeenCalledWith('拾语学习资料.html', expect.stringContaining('resilient'), 'text/html;charset=utf-8');
    await fill(field('资料类型'), 'worksheet');
    await click(button('打印 / 保存为 PDF'));
    expect(exports.buildDocument).toHaveBeenLastCalledWith(state.entries, [], {mode: 'worksheet', translations: true, answers: true, sources: true, englishDefinition: true, context: true, notes: true});
    expect(exports.openPrintDocument).toHaveBeenCalledWith(expect.stringContaining('resilient'));
  });

  it('passes the new export switches through to document generation', async () => {
    await click(button('导出资料'));
    await click(field('包含英英释义'));
    await click(field('包含例句／上下文'));
    await click(field('包含个人笔记'));
    await click(button('下载 HTML'));
    expect(exports.buildDocument).toHaveBeenCalledWith(state.entries, [], {mode: 'bilingual', translations: true, answers: true, sources: true, englishDefinition: false, context: false, notes: false});
  });

  it('renders the layered review card and keeps rating actions usable with long answers', async () => {
    await mountWith([{ ...core.newEntry('resilient'), id: 'seed-entry', translation: '有韧性的；能在困境后很快恢复的'.repeat(30), englishDefinition: 'able to recover quickly from difficulties'.repeat(10), context: 'She is resilient.', due: Date.now() - 1000 }]);
    await click(button('今日复习'));
    expect(document.querySelector('.review-status')?.textContent).toContain('第 1 条');
    expect(document.querySelector('.review-status')?.textContent).toContain('单词');
    expect(document.querySelector('.review-status')?.textContent).toContain('手动添加');
    expect(document.querySelector('.review-expression')?.textContent).toBe('resilient');
    expect(document.querySelector('.review-body .answer')).toBeNull();
    await click(button('查看参考答案'));
    const answer = document.querySelector('.answer');
    expect(answer?.textContent).toContain('英英释义');
    expect(answer?.textContent).toContain('able to recover quickly');
    expect(answer?.textContent).toContain('有韧性的');
    expect(answer?.textContent).toContain('语境与用法');
    expect(document.querySelector('.review-actions')).not.toBeNull();
    expect([...document.querySelectorAll('.review-actions button')].map(b => b.textContent)).toEqual(['忘记 · 10 分钟后', '模糊 · 稍后再练', '记住 · 延长间隔']);
    const before = Date.now();
    await click(button('记住 · 延长间隔'));
    const saved = vi.mocked(core.saveEntry).mock.calls[0][0];
    expect(saved.id).toBe('seed-entry');
    expect(saved.interval).toBe(1);
    expect(saved.due).toBeGreaterThanOrEqual(before + 86400000);
    expect(document.body.textContent).toContain('当前复习已完成');
  });

  it('cleans markdown markers from AI content on cards and in review answers', async () => {
    await mountWith([{ ...core.newEntry('give up'), id: 'md-entry', translation: '**放弃** `something`', englishDefinition: '## to stop trying', context: '- bullet point', notes: 'plain note', due: Date.now() - 1000 }]);
    const card = document.querySelector('.entry');
    expect(card?.textContent).toContain('英英释义');
    expect(card?.textContent).toContain('to stop trying');
    expect(card?.textContent).toContain('放弃 something');
    expect(card?.textContent).not.toContain('**');
    expect(card?.textContent).not.toContain('`');
    expect(card?.textContent).not.toContain('##');
    await click(button('今日复习'));
    await click(button('查看参考答案'));
    const answer = document.querySelector('.answer');
    expect(answer?.textContent).not.toContain('**');
    expect(answer?.textContent).not.toContain('`');
    expect(answer?.textContent).toContain('放弃');
    expect(answer?.textContent).toContain('plain note');
  });

  it('generates structured definitions into the editor and persists the field', async () => {
    vi.mocked(core.callAI).mockResolvedValue(JSON.stringify({ englishDefinition: 'to stop trying', translation: '放弃', usage: 'Never give up.' }));
    await click(button('添加词句'));
    await fill(field('英文原文'), 'give up');
    await click(button('AI 生成释义'));
    expect(confirm).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect((field('English definition') as HTMLTextAreaElement).value).toBe('to stop trying');
      expect((field('中文释义') as HTMLTextAreaElement).value).toBe('放弃');
      expect((field('用法与个人笔记') as HTMLTextAreaElement).value).toBe('Never give up.');
    });
    await click(button('保存到学习库'));
    expect(core.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ text: 'give up', englishDefinition: 'to stop trying', translation: '放弃', notes: 'Never give up.' }));
    const card = [...document.querySelectorAll('.entry')].find(e => e.textContent?.includes('give up'));
    expect(card?.textContent).toContain('英英释义');
    expect(card?.textContent).toContain('to stop trying');
  });
});
