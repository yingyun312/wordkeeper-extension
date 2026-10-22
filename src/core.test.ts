import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { apiEndpoint, callAI, definitionOf, deleteEntries, estimateLevel, exportBackup, getSettings, importBackup, levelOf, listArticles, listEntries, makeCloze, newEntry, notesOf, parseArticle, parseClassificationResult, parseTranslationResult, requestAI, reviewEntry, saveArticle, saveEntry, saveSettings, type Settings } from './core';

const settings: Settings = { baseUrl: 'https://example.test/v1', model: 'test-model', key: 'test-secret', remember: false };
const articleJSON = JSON.stringify({ title: 'A day', paragraphs: [{ en: 'A good day.', zh: '美好的一天。' }], questions: [{ question: 'How was the day?', answer: 'Good.' }] });
const backup = (entries: unknown[], articles: unknown[] = []) => JSON.stringify({ version: 1, entries, articles });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  // Never let any test accidentally make a real network request.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  vi.stubGlobal('chrome', undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pure study logic', () => {
  it('creates complete independent entries and infers types', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const first = newEntry('  apple  ');
    expect(first).toMatchObject({ text: 'apple', type: 'word', translation: '', tags: [], notes: '', context: '', sourceUrl: '', sourceTitle: '', interval: 0, createdAt: 1234, due: 1234 });
    expect(newEntry('apple').id).not.toBe(first.id);
    expect(newEntry('give up').type).toBe('idiom');
    expect(newEntry('Hello world!').type).toBe('sentence');
  });
  it('schedules each rating without mutating the input', () => {
    const entry = { ...newEntry('word'), interval: 4 };
    expect(reviewEntry(entry, 'forgot', 1000)).toMatchObject({ interval: 0, due: 601000 });
    expect(reviewEntry(entry, 'hard', 1000)).toMatchObject({ interval: 5, due: 1000 + 5 * 86400000 });
    expect(reviewEntry(entry, 'good', 1000)).toMatchObject({ interval: 10, due: 1000 + 10 * 86400000 });
    expect(entry.interval).toBe(4);
    expect(reviewEntry(newEntry('word'), 'good', 0).interval).toBe(1);
    expect(() => reviewEntry(entry, 'good', NaN)).toThrow('参数');
  });
  it('makes case-insensitive cloze blanks only for whole targets', () => {
    expect(makeCloze({ ...newEntry('cat'), context: 'Cat, cat! A category and bobcat.' })).toBe('_____, _____! A category and bobcat.');
    expect(makeCloze({ ...newEntry('c++'), context: 'Use C++ today.' })).toBe('Use _____ today.');
    expect(makeCloze({ ...newEntry('give up'), context: 'Never give  up.' })).toBe('Never _____.');
    expect(makeCloze({ ...newEntry('cat'), context: 'category' })).toBeNull();
    expect(makeCloze(newEntry('cat'))).toBeNull();
  });
  it('parses plain and fenced article JSON and controls generated metadata', () => {
    const targets = ['good'];
    const article = parseArticle('```json\n' + articleJSON + '\n```', targets);
    targets.push('changed');
    expect(article).toMatchObject({ title: 'A day', targets: ['good'], paragraphs: [{ en: 'A good day.', zh: '美好的一天。' }] });
    expect(article.id).toBeTruthy();
    expect(parseArticle(articleJSON, []).questions).toHaveLength(1);
    expect(() => parseArticle('not JSON', [])).toThrow('JSON');
    expect(() => parseArticle('null', [])).toThrow('格式');
    expect(() => parseArticle('{"title":"Missing paragraphs"}', [])).toThrow('文章');
    expect(() => parseArticle(JSON.stringify({ title: 'x', paragraphs: [{ en: 3, zh: '' }], questions: [] }), [])).toThrow();
  });
});

describe('transactional IndexedDB storage', () => {
  it('saves, updates, lists and deletes entries, keeping internal indexes private', async () => {
    const entry = newEntry('Apple');
    await saveEntry(entry);
    await saveEntry({ ...entry, notes: 'updated' });
    expect(await listEntries()).toEqual([{ ...entry, notes: 'updated' }]);
    await expect(saveEntry(newEntry('  ＡＰＰＬＥ  '))).rejects.toThrow('重复');
    expect(await listEntries()).toHaveLength(1);
    await deleteEntries([entry.id]);
    expect(await listEntries()).toEqual([]);
  });
  it('collapses whitespace when checking uniqueness', async () => {
    await saveEntry(newEntry('give up'));
    await expect(saveEntry(newEntry('GIVE   UP'))).rejects.toThrow('重复');
  });
  it('exports a consistent versioned backup without settings or private index fields', async () => {
    const entry = newEntry('good'); const article = parseArticle(articleJSON, ['good']);
    await saveEntry(entry); await saveArticle(article);
    expect(await listArticles()).toEqual([article]);
    expect(JSON.parse(await exportBackup())).toEqual({ version: 1, entries: [entry], articles: [article] });
  });
  it('merges atomically and skips existing IDs, normalized texts and in-file duplicates', async () => {
    const old = newEntry('good'); const fresh = newEntry('new'); const article = parseArticle(articleJSON, ['good']);
    await saveEntry(old); await saveArticle(article);
    const result = await importBackup(backup([
      { ...old, translation: 'must not overwrite' }, newEntry(' GOOD '), fresh, { ...fresh, id: 'other' },
    ], [article, { ...article, id: 'new-article' }]));
    expect(result).toEqual({ added: 2, skipped: 4 });
    expect(await listEntries()).toContainEqual(old);
    expect(await listEntries()).toHaveLength(2);
    expect(await listArticles()).toHaveLength(2);
  });
  it('rejects the whole backup before writing when a later record is invalid', async () => {
    await expect(importBackup(backup([newEntry('valid'), { ...newEntry('bad'), due: -1 }]))).rejects.toThrow('收藏');
    expect(await listEntries()).toEqual([]);
    await expect(importBackup(backup([newEntry('valid')], [{ title: 'bad' }]))).rejects.toThrow('文章');
    expect(await listEntries()).toEqual([]);
  });
  it('strictly rejects wrong versions, malformed values, unknown fields and empty text', async () => {
    for (const text of ['{', 'null', '{"version":2,"entries":[],"articles":[]}', '{"version":1,"entries":[]}']) {
      await expect(importBackup(text)).rejects.toThrow();
    }
    for (const patch of [{ text: ' ' }, { tags: [2] }, { type: 'other' }, { createdAt: null }, { unexpected: true }]) {
      await expect(importBackup(backup([{ ...newEntry('x'), ...patch }]))).rejects.toThrow();
    }
    expect(await listEntries()).toEqual([]);
  });
});

describe('english definition compatibility', () => {
  it('defaults the field for legacy records and round-trips it through backup', async () => {
    const { englishDefinition: _legacyField, ...legacy } = newEntry('legacy');
    await importBackup(backup([legacy]));
    const [stored] = await listEntries();
    expect(stored.englishDefinition).toBe('');
    expect(JSON.parse(await exportBackup()).entries[0]).toMatchObject({ text: 'legacy', englishDefinition: '' });
    await saveEntry({ ...stored, englishDefinition: 'an old word for legacy' });
    expect((await listEntries())[0].englishDefinition).toBe('an old word for legacy');
    expect(await exportBackup()).toContain('an old word for legacy');
  });

  it('reads legacy marker-packed definitions and strips them from notes', () => {
    const legacy = { ...newEntry('legacy'), notes: '__WORDKEEP_ENGLISH_DEFINITION__\nold but gold\n__WORDKEEP_ENGLISH_DEFINITION__\nmy own note' };
    expect(definitionOf(legacy)).toBe('old but gold');
    expect(notesOf(legacy)).toBe('my own note');
    const modern = { ...newEntry('modern'), englishDefinition: 'current', notes: 'plain notes' };
    expect(definitionOf(modern)).toBe('current');
    expect(notesOf(modern)).toBe('plain notes');
    expect(definitionOf({ ...modern, englishDefinition: '   ' })).toBe('');
    expect(definitionOf({ ...modern, englishDefinition: '   ', notes: '__WORDKEEP_ENGLISH_DEFINITION__\nfrom notes\n__WORDKEEP_ENGLISH_DEFINITION__\n' })).toBe('from notes');
    expect(notesOf({ ...modern, notes: undefined as unknown as string })).toBe('');
  });
});

describe('parseTranslationResult', () => {
  it('extracts structured fields from plain and fenced JSON', () => {
    const structured = { phonetic: 'ˈfruːt', englishDefinition: 'a round fruit', translation: '水果', notes: 'eat it' };
    expect(parseTranslationResult('{"phonetic":"/ˈfruːt/","englishDefinition":"a round fruit","translation":"水果","usage":"eat it"}')).toEqual(structured);
    expect(parseTranslationResult('```json\n{"phonetic":"/ˈfruːt/","englishDefinition":"a round fruit","translation":"水果","usage":"eat it"}\n```')).toEqual(structured);
    expect(parseTranslationResult('{"translation":"只有中文"}')).toEqual({ phonetic: '', englishDefinition: '', translation: '只有中文', notes: '' });
  });

  it('falls back to plain text as the Chinese translation only', () => {
    expect(parseTranslationResult('一个普通的回答')).toEqual({ phonetic: '', englishDefinition: '', translation: '一个普通的回答', notes: '' });
    expect(parseTranslationResult('not json at all')).toEqual({ phonetic: '', englishDefinition: '', translation: 'not json at all', notes: '' });
    expect(parseTranslationResult('')).toEqual({ phonetic: '', englishDefinition: '', translation: '', notes: '' });
  });
});

describe('AI requests (mock fetch only)', () => {
  it('builds HTTPS completion endpoints without duplicating their suffix', () => {
    expect(apiEndpoint(settings.baseUrl).href).toBe('https://example.test/v1/chat/completions');
    expect(apiEndpoint('https://example.test/v1/chat/completions/').href).toBe('https://example.test/v1/chat/completions');
    for (const url of ['http://example.test', 'javascript:alert(1)', 'https://user:pass@example.test', 'https://example.test?key=x', 'https://example.test#x', 'invalid']) expect(() => apiEndpoint(url)).toThrow();
  });
  it('sends the expected OpenAI-compatible request and returns text', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Answer' } }] })));
    await expect(requestAI(settings, 'Prompt')).resolves.toBe('Answer');
    expect(fetch).toHaveBeenCalledWith('https://example.test/v1/chat/completions', expect.objectContaining({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' }, body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'Prompt' }] }), signal: expect.any(AbortSignal) }));
  });
  it.each([401, 429, 500])('reports HTTP %i without exposing provider response bodies', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('secret server response', { status }));
    await expect(requestAI(settings, 'Prompt')).rejects.toThrow(String(status));
  });
  it.each(['not json', '{}', 'null', '{"choices":[{"message":{"content":[]}}]}', '{"choices":[{"message":{"content":" "}}]}'])('rejects malformed provider response %s', async body => {
    vi.mocked(fetch).mockResolvedValue(new Response(body));
    await expect(requestAI(settings, 'Prompt')).rejects.toThrow(/JSON|文本/);
  });
  it('aborts and reports a timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const assertion = expect(requestAI(settings, 'Prompt', 50)).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('validates before requesting and propagates network errors', async () => {
    await expect(requestAI({ ...settings, key: '' }, 'Prompt')).rejects.toThrow('Key');
    await expect(requestAI(settings, '')).rejects.toThrow('不能为空');
    await expect(requestAI(settings, 'Prompt', 0)).rejects.toThrow('超时');
    await expect(requestAI({ ...settings, baseUrl: 'http://example.test' }, 'Prompt')).rejects.toThrow('HTTPS');
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValue(new Error('Network unavailable'));
    await expect(requestAI(settings, 'Prompt')).rejects.toThrow('Network unavailable');
  });
});

function mockChrome() {
  const local: Record<string, unknown> = {}; const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
    remove: vi.fn(async (key: string) => { delete data[key]; }),
    setAccessLevel: vi.fn(async () => {}),
  });
  const browser = { runtime: { id: 'extension', sendMessage: vi.fn(async (_message: unknown): Promise<unknown> => ({ ok: true, text: 'answer' })) }, storage: { local: area(local), session: area(session) }, permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } };
  vi.stubGlobal('chrome', browser);
  return { browser, local, session };
}

describe('settings and background transport', () => {
  it('keeps keys in trusted session storage by default and moves remembered keys to local', async () => {
    const { browser, local, session } = mockChrome();
    await saveSettings(settings);
    expect(local.settings).toEqual({ ...settings, key: '' });
    expect(session.apiKey).toBe(settings.key);
    expect(await getSettings()).toEqual(settings);
    expect(browser.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(browser.storage.session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    await saveSettings({ ...settings, remember: true });
    expect(local.settings).toEqual({ ...settings, remember: true });
    expect(session.apiKey).toBeUndefined();
    expect(await getSettings()).toEqual({ ...settings, remember: true });
    await saveSettings(settings);
    expect(local.settings).toEqual({ ...settings, key: '' });
  });
  it('fails closed when storage protection fails', async () => {
    const { browser } = mockChrome();
    browser.storage.local.setAccessLevel.mockRejectedValue(new Error('Denied'));
    await expect(saveSettings(settings)).rejects.toThrow('Denied');
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
  it('uses the ai message contract and handles background errors', async () => {
    const { browser } = mockChrome();
    await saveSettings(settings);
    await expect(callAI('Prompt')).resolves.toBe('answer');
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'ai', prompt: 'Prompt' });
    expect(fetch).not.toHaveBeenCalled();
    browser.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Background failed' });
    await expect(callAI('Prompt')).rejects.toThrow('Background failed');
    browser.runtime.sendMessage.mockResolvedValue({ ok: true, text: '' });
    await expect(callAI('Prompt')).rejects.toThrow('响应无效');
  });
  it('does not send AI requests when host permission is denied', async () => {
    const { browser } = mockChrome();
    browser.permissions.contains.mockResolvedValue(false);
    browser.permissions.request.mockResolvedValue(false);
    await expect(callAI('Prompt')).rejects.toThrow('权限');
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it('allows key-free local preview settings but rejects AI calls', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    await saveSettings({ ...settings, remember: true });
    expect(await getSettings()).toEqual({ ...settings, key: '', remember: false });
    expect([...store.values()].join('')).not.toContain('test-secret');
    await expect(callAI('Prompt')).rejects.toThrow('预览模式');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('classification logic', () => {
  it('always returns a level and marks locally estimated values', () => {
    const entry = newEntry('apple');
    expect(levelOf(entry).level).toBeTruthy();
    expect(levelOf(entry).estimated).toBe(true);
    expect(levelOf({ ...entry, level: 'B2' })).toEqual({ level: 'B2', estimated: false });
  });
  it('estimates harder levels for longer, more complex text', () => {
    expect(['A1', 'A2']).toContain(estimateLevel('a cat'));
    expect(['B2', 'C1', 'C2']).toContain(estimateLevel('Although the proposal was criticized, the committee nevertheless approved it after a lengthy discussion.'));
  });
  it('parses structured classification JSON and ignores invalid levels', () => {
    const parsed = parseClassificationResult(JSON.stringify([{ id: 'a', level: 'B1', topic: '科技' }, { id: 'b', level: 'Z9', topic: 'x' }, { id: 'c', level: 'C2' }]));
    expect(parsed).toEqual([{ id: 'a', level: 'B1', topic: '科技', phonetic: '' }, { id: 'c', level: 'C2', topic: '其他', phonetic: '' }]);
  });
  it('accepts fenced JSON objects with an items array', () => {
    expect(parseClassificationResult('```json\n{"items":[{"id":"a","level":"A2","topic":"旅行"}]}\n```')).toEqual([{ id: 'a', level: 'A2', topic: '旅行', phonetic: '' }]);
  });
});
