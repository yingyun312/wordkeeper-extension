import { beforeEach, describe, expect, it, vi } from 'vitest';

let stored: Record<string, unknown> | undefined;
const saveEntry = vi.fn(async (entry: Record<string, unknown>) => { stored = entry; });
const getEntry = vi.fn(async (id: string) => stored?.id === id ? stored : undefined);
const requestAI = vi.fn();
const getSettings = vi.fn(async () => ({ baseUrl: 'https://api.example.test/v1', model: 'model', key: 'key', remember: false }));
vi.mock('./core', async importOriginal => {
  const actual = await importOriginal<typeof import('./core')>();
  return {
    ...actual,
    apiEndpoint: (base: string) => new URL(`${base.replace(/\/$/, '')}/chat/completions`),
    getSettings,
    getEntry,
    newEntry: (text: string) => ({ id: 'entry-1', text: text.trim(), englishDefinition: '', translation: '', translationStatus: 'pending', context: '', type: 'word', tags: [], notes: '', sourceUrl: '', sourceTitle: '', createdAt: 1, due: 1, interval: 0 }),
    requestAI,
    saveEntry,
  };
});

function chromeMock() {
  const listeners: Array<(message: unknown, sender: { id: string; url: string }, send: (value: unknown) => void) => unknown> = [];
  const browser = {
    runtime: { id: 'extension', getURL: (path = '') => `chrome-extension://id/${path}`, sendMessage: vi.fn(async () => undefined), onInstalled: { addListener: vi.fn() }, onMessage: { addListener: vi.fn((fn) => listeners.push(fn)) } },
    storage: { local: { setAccessLevel: vi.fn(async () => {}) }, session: { setAccessLevel: vi.fn(async () => {}) } },
    permissions: { contains: vi.fn(async () => true) },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined), create: vi.fn(async () => {}) },
    contextMenus: { removeAll: vi.fn(), create: vi.fn(), onClicked: { addListener: vi.fn() } },
  };
  vi.stubGlobal('chrome', browser);
  return { browser, listeners };
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); stored = undefined; });

describe('save-and-translate background flow', () => {
  it('saves pending first and updates the same id after translation', async () => {
    const { listeners } = chromeMock();
    requestAI.mockResolvedValue('中文释义');
    const { saveAndTranslate } = await import('./background');
    const entry = await saveAndTranslate({ type: 'save-and-translate', text: ' apple ', context: 'an apple', sourceUrl: 'https://example.test', sourceTitle: 'Example' });
    expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, translationStatus: 'pending' }));
    await vi.waitFor(() => expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, translation: '中文释义', translationStatus: 'done' })));
    expect(listeners).toHaveLength(1);
    expect(entry.sourceTitle).toBe('Example');
  });

  it('retains the entry and records failed translation', async () => {
    chromeMock();
    requestAI.mockRejectedValue(new Error('未配置 API Key'));
    const { saveAndTranslate } = await import('./background');
    await saveAndTranslate({ type: 'save-and-translate', text: 'apple', context: '', sourceUrl: '', sourceTitle: '' });
    await vi.waitFor(() => expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ translationStatus: 'failed', translationError: '未配置 API Key' })));
    expect(saveEntry.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('saves structured English definition, translation and usage notes', async () => {
    const { listeners } = chromeMock();
    requestAI.mockResolvedValue(JSON.stringify({ englishDefinition: 'able to recover quickly', translation: '有韧性的', usage: 'She is resilient.' }));
    const { saveAndTranslate } = await import('./background');
    const entry = await saveAndTranslate({ type: 'save-and-translate', text: 'resilient', context: '', sourceUrl: '', sourceTitle: '' });
    await vi.waitFor(() => expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, englishDefinition: 'able to recover quickly', translation: '有韧性的', notes: 'She is resilient.', translationStatus: 'done' })));
    expect(listeners).toHaveLength(1);
  });

  it('falls back to plain text as the Chinese translation only', async () => {
    chromeMock();
    requestAI.mockResolvedValue('一个有韧性的词');
    const { saveAndTranslate } = await import('./background');
    const entry = await saveAndTranslate({ type: 'save-and-translate', text: 'resilient', context: '', sourceUrl: '', sourceTitle: '' });
    await vi.waitFor(() => expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, englishDefinition: '', translation: '一个有韧性的词', notes: '', translationStatus: 'done' })));
  });

  it('rejects oversized or malformed requests before saving', async () => {
    chromeMock();
    const { saveAndTranslate } = await import('./background');
    await expect(saveAndTranslate({ type: 'save-and-translate', text: ' ', context: '', sourceUrl: '', sourceTitle: '' })).rejects.toThrow();
    await expect(saveAndTranslate({ type: 'save-and-translate', text: 'x'.repeat(10001), context: '', sourceUrl: '', sourceTitle: '' })).rejects.toThrow();
    expect(saveEntry).not.toHaveBeenCalled();
  });
});
