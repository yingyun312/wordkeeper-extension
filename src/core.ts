export type TranslationStatus = 'pending' | 'done' | 'failed';
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Level = typeof LEVELS[number];
export const TOPICS = ['日常生活', '职场工作', '学习教育', '科技', '健康', '情感关系', '旅行', '文化娱乐', '社会议题', '环境自然', '商业经济', '其他'] as const;
export type Topic = typeof TOPICS[number];
export type Entry = { id: string; text: string; phonetic?: string; englishDefinition: string; translation: string; translationStatus?: TranslationStatus; translationError?: string; context: string; type: 'word' | 'idiom' | 'sentence'; tags: string[]; notes: string; sourceUrl: string; sourceTitle: string; createdAt: number; due: number; interval: number; level?: Level | ''; topic?: Topic | string };
export type Article = { id: string; title: string; paragraphs: { en: string; zh: string }[]; questions: { question: string; answer: string }[]; targets: string[]; createdAt: number };
export type Settings = { baseUrl: string; model: string; key: string; remember: boolean };
const defaults: Settings = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', remember: false };
const normalize = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const runtimeAvailable = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const uuid = () => crypto.randomUUID();
export function inferType(text: string): Entry['type'] {
  const clean = text.trim();
  const words = clean.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  if (/[.!?。！？]["'”’)]?$/.test(clean) || words.length >= 7) return 'sentence';
  if (words.length >= 2) return 'idiom';
  return 'word';
}
export function newEntry(text: string): Entry {
  const now = Date.now();
  return { id: uuid(), text: text.trim(), phonetic: '', englishDefinition: '', translation: '', translationStatus: 'pending', context: '', type: inferType(text), tags: [], notes: '', sourceUrl: '', sourceTitle: '', createdAt: now, due: now, interval: 0, level: '', topic: '' };
}
/** Local CEFR estimate. Deliberately cheap: AI classification replaces it when requested. */
export function estimateLevel(text: string): Level {
  const words = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  if (!words.length) return 'A1';
  const lengths = words.map(word => word.length);
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const longWords = lengths.filter(length => length >= 8).length / lengths.length;
  let score = average <= 4.2 ? 0 : average <= 5 ? 1 : average <= 5.9 ? 2 : average <= 6.8 ? 3 : 4;
  if (words.length >= 12) score += 1;
  if (words.length >= 22) score += 1;
  if (/[,;:]|\b(although|whereas|despite|unless|nevertheless|therefore|which|whose)\b/i.test(text)) score += 1;
  if (longWords >= 0.28) score += 1;
  if (words.length === 1 && /\w(?:tion|sion|ous|ity|ize|ise|ate|ive|al)$/i.test(words[0])) score += 1;
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, score))];
}
export function levelOf(entry: Entry): { level: Level; estimated: boolean } {
  const stored = LEVELS.find(level => level === entry.level);
  return stored ? { level: stored, estimated: false } : { level: estimateLevel(entry.text), estimated: true };
}
export function topicOf(entry: Entry): string { return (entry.topic || '').trim(); }
export function cleanPhonetic(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^[/[]+/, '').replace(/[/\]]+$/, '').trim().slice(0, 200) : '';
}
export function parseClassificationResult(raw: string): { id: string; level: Level; topic: string; phonetic: string }[] {
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  let data: unknown;
  try { data = JSON.parse(candidate); } catch { throw new Error('分类结果不是有效 JSON'); }
  const items: unknown[] | null = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items) ? (data as Record<string, unknown>).items as unknown[] : null);
  if (!items) throw new Error('分类结果格式无效');
  return items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const level = LEVELS.find(level => level === value.level);
    if (typeof value.id !== 'string' || !level) return [];
    return [{ id: value.id, level, topic: typeof value.topic === 'string' && value.topic.trim() ? value.topic.trim().slice(0, 30) : '其他', phonetic: cleanPhonetic(value.phonetic) }];
  });
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('english-study', 2);
    let blocked = false;
    r.onupgradeneeded = () => {
      const db = r.result;
      const entries = db.objectStoreNames.contains('entries') ? r.transaction!.objectStore('entries') : db.createObjectStore('entries', { keyPath: 'id' });
      if (!entries.indexNames.contains('normalizedText')) entries.createIndex('normalizedText', 'normalizedText', { unique: true });
      if (!db.objectStoreNames.contains('articles')) db.createObjectStore('articles', { keyPath: 'id' });
      // Keep old records readable while adding the explicit translation state.
      const cursor = entries.openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; const value = c.value; let changed = false; if (value.englishDefinition === undefined) { value.englishDefinition = ''; changed = true; } if (!value.translationStatus) { value.translationStatus = value.translation?.trim() ? 'done' : 'pending'; delete value.translationError; changed = true; } if (changed) c.update(value); c.continue(); };
    };
    r.onsuccess = () => { if (blocked) { r.result.close(); return; } r.result.onversionchange = () => r.result.close(); resolve(r.result); };
    r.onerror = () => reject(r.error);
    r.onblocked = () => { blocked = true; reject(new Error('数据库被其他页面阻塞，请关闭旧页面后重试')); };
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('数据库事务已取消')); });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => (() => T)): Promise<T> {
  const db = await openDB();
  try {
    const tx = db.transaction(stores, mode);
    const done = complete(tx);
    let result: () => T;
    try { result = run(tx); } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
    await done;
    return result();
  } finally { db.close(); }
}
function normalizeEntry(value: (Partial<Entry> & { normalizedText?: string }) & { id: string; text: string }): Entry {
  const { normalizedText: _, ...entry } = value;
  return { ...entry, phonetic: entry.phonetic || '', englishDefinition: entry.englishDefinition === undefined ? '' : entry.englishDefinition, level: entry.level || '', topic: entry.topic || '', translationStatus: entry.translationStatus || (entry.translation?.trim() ? 'done' : 'pending') } as Entry;
}
function withoutIndex(value: Entry & { normalizedText?: string }): Entry { return normalizeEntry(value); }
export async function listEntries(): Promise<Entry[]> {
  return transaction(['entries'], 'readonly', tx => { const req = tx.objectStore('entries').getAll(); return () => req.result.map(withoutIndex); });
}
export async function getEntry(id: string): Promise<Entry | undefined> {
  if (typeof id !== 'string' || !id.trim()) throw new Error('无效的收藏 ID');
  return transaction(['entries'], 'readonly', tx => {
    const req = tx.objectStore('entries').get(id);
    return () => req.result ? withoutIndex(req.result) : undefined;
  });
}
export async function listArticles(): Promise<Article[]> {
  return transaction(['articles'], 'readonly', tx => { const req = tx.objectStore('articles').getAll(); return () => req.result; });
}
export async function saveEntry(entry: Entry | (Omit<Entry, 'englishDefinition'> & { englishDefinition?: string })): Promise<void> {
  const normalized = normalizeEntry(entry as Entry & { id: string; text: string });
  validateEntry(normalized);
  try { await transaction(['entries'], 'readwrite', tx => { tx.objectStore('entries').put({ ...normalized, normalizedText: normalize(normalized.text) }); return () => {}; }); }
  catch (e) { if ((e as DOMException)?.name === 'ConstraintError') throw new Error('该文本已收藏（重复）'); throw e; }
}
export async function deleteEntries(ids: string[]): Promise<void> {
  if (!strings(ids)) throw new Error('无效的收藏 ID');
  await transaction(['entries'], 'readwrite', tx => { ids.forEach(id => tx.objectStore('entries').delete(id)); return () => {}; });
}
export async function saveArticle(article: Article): Promise<void> {
  validateArticle(article);
  await transaction(['articles'], 'readwrite', tx => { tx.objectStore('articles').put(article); return () => {}; });
}
function record(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function strings(x: unknown): x is string[] { return Array.isArray(x) && x.every(v => typeof v === 'string'); }
function number(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }
function keys(x: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(x).every(k => allowed.includes(k)); }
function validateEntry(x: unknown): asserts x is Entry {
  if (!record(x) || !keys(x, ['id', 'text', 'phonetic', 'englishDefinition', 'translation', 'translationStatus', 'translationError', 'context', 'type', 'tags', 'notes', 'sourceUrl', 'sourceTitle', 'createdAt', 'due', 'interval', 'level', 'topic']) || !['id', 'text', 'englishDefinition', 'translation', 'context', 'notes', 'sourceUrl', 'sourceTitle'].every(k => typeof x[k] === 'string') || (x.phonetic !== undefined && typeof x.phonetic !== 'string') || (typeof x.phonetic === 'string' && x.phonetic.length > 200) || (x.translationError !== undefined && typeof x.translationError !== 'string') || (x.level !== undefined && typeof x.level !== 'string') || (x.topic !== undefined && typeof x.topic !== 'string') || (typeof x.level === 'string' && x.level !== '' && !LEVELS.includes(x.level as Level)) || (typeof x.topic === 'string' && x.topic.length > 30) || !(x.id as string).trim() || !normalize(x.text as string) || (x.translationStatus !== undefined && !['pending', 'done', 'failed'].includes(x.translationStatus as string)) || !['word', 'idiom', 'sentence'].includes(x.type as string) || !strings(x.tags) || !['createdAt', 'due', 'interval'].every(k => number(x[k]))) throw new Error('无效的收藏数据');
}
function validateArticle(x: unknown): asserts x is Article {
  if (!record(x) || !keys(x, ['id', 'title', 'paragraphs', 'questions', 'targets', 'createdAt']) || typeof x.id !== 'string' || !x.id.trim() || typeof x.title !== 'string' || !x.title.trim() || !number(x.createdAt) || !strings(x.targets) || !Array.isArray(x.paragraphs) || !x.paragraphs.length || !x.paragraphs.every(p => record(p) && keys(p, ['en', 'zh']) && typeof p.en === 'string' && !!p.en.trim() && typeof p.zh === 'string') || !Array.isArray(x.questions) || !x.questions.every(q => record(q) && keys(q, ['question', 'answer']) && typeof q.question === 'string' && !!q.question.trim() && typeof q.answer === 'string' && !!q.answer.trim())) throw new Error('无效的文章数据');
}
export async function exportBackup(): Promise<string> {
  return transaction(['entries', 'articles'], 'readonly', tx => {
    const e = tx.objectStore('entries').getAll(); const a = tx.objectStore('articles').getAll();
    return () => JSON.stringify({ version: 1, entries: e.result.map(withoutIndex), articles: a.result }, null, 2);
  });
}
export async function importBackup(json: string): Promise<{ added: number; skipped: number }> {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('备份不是有效 JSON'); }
  if (!record(data) || !keys(data, ['version', 'entries', 'articles']) || data.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.articles)) throw new Error('备份格式无效，需要 version: 1、entries 和 articles');
  const entries = data.entries.map(value => normalizeEntry(value as (Partial<Entry> & { id: string; text: string }))); const articles = data.articles as Article[];
  entries.forEach(validateEntry); articles.forEach(validateArticle);
  return transaction(['entries', 'articles'], 'readwrite', tx => {
    let added = 0; let skipped = 0;
    const es = tx.objectStore('entries'); const as = tx.objectStore('articles');
    const er = es.getAll(); const ar = as.getAll();
    // All requests execute in order; enqueue every write while the transaction is active.
    ar.onsuccess = () => {
      try {
        const ids = new Set(er.result.map(e => e.id)); const texts = new Set(er.result.map(e => normalize(e.text)));
        for (const e of entries) { const text = normalize(e.text); if (ids.has(e.id) || texts.has(text)) { skipped++; continue; } ids.add(e.id); texts.add(text); es.add({ ...e, normalizedText: text }); added++; }
        const articleIds = new Set(ar.result.map(a => a.id));
        for (const a of articles) { if (articleIds.has(a.id)) { skipped++; continue; } articleIds.add(a.id); as.add(a); added++; }
      } catch { tx.abort(); }
    };
    return () => ({ added, skipped });
  });
}
export function apiEndpoint(baseUrl: string): URL {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('API 地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须使用 HTTPS，且不能包含凭据、查询或片段');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url;
}
async function protectStorage(): Promise<void> {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
}
function readSettings(value: unknown): Settings {
  if (!record(value)) return { ...defaults };
  return { baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : defaults.baseUrl, model: typeof value.model === 'string' ? value.model : defaults.model, key: typeof value.key === 'string' ? value.key : '', remember: value.remember === true };
}
export async function getSettings(): Promise<Settings> {
  if (!runtimeAvailable()) {
    try { return { ...readSettings(JSON.parse(localStorage.getItem('english-study-settings') || '{}')), key: '', remember: false }; } catch { return { ...defaults }; }
  }
  await protectStorage();
  const local = await chrome.storage.local.get('settings');
  const saved = readSettings(local.settings);
  if (!saved.remember) { const session = await chrome.storage.session.get('apiKey'); saved.key = typeof session.apiKey === 'string' ? session.apiKey : ''; }
  return saved;
}
export async function saveSettings(s: Settings): Promise<void> {
  apiEndpoint(s.baseUrl);
  if (typeof s.model !== 'string' || !s.model.trim() || typeof s.key !== 'string' || typeof s.remember !== 'boolean') throw new Error('设置无效');
  if (!runtimeAvailable()) { localStorage.setItem('english-study-settings', JSON.stringify({ baseUrl: s.baseUrl, model: s.model, key: '', remember: false })); return; }
  await protectStorage();
  await chrome.storage.local.set({ settings: { baseUrl: s.baseUrl, model: s.model, key: s.remember ? s.key : '', remember: s.remember } });
  if (s.remember) await chrome.storage.session.remove('apiKey'); else await chrome.storage.session.set({ apiKey: s.key });
}
export async function callAI(prompt: string): Promise<string> {
  if (!runtimeAvailable()) throw new Error('AI 仅可在已安装的 Chrome 扩展中使用，预览模式不支持');
  if (!prompt.trim()) throw new Error('提示词不能为空');
  const settings = await getSettings(); const url = apiEndpoint(settings.baseUrl); const origins = [`${url.origin}/*`];
  if (!await chrome.permissions.contains({ origins }) && !await chrome.permissions.request({ origins })) throw new Error('未授予 API 主机访问权限');
  const response = await chrome.runtime.sendMessage({ type: 'ai', prompt });
  if (response?.ok !== true || typeof response.text !== 'string' || !response.text.trim()) throw new Error(typeof response?.error === 'string' ? response.error : 'AI 后台响应无效');
  return response.text;
}
export async function requestAI(settings: Settings, prompt: string, timeoutMs = 60000): Promise<string> {
  const url = apiEndpoint(settings.baseUrl);
  if (!settings.key.trim()) throw new Error('请先填写 API Key');
  if (!settings.model.trim() || !prompt.trim()) throw new Error('模型和提示词不能为空');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('超时时间必须为正数');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.href, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` }, body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: prompt }] }) });
    if (!res.ok) throw new Error(res.status === 401 ? 'API 认证失败（401），请检查 Key' : res.status === 429 ? 'API 请求过多或额度不足（429）' : `API 请求失败（${res.status}）`);
    let data;
    try { data = await res.json(); } catch { throw new Error('API 返回的不是有效 JSON'); }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('API 响应缺少有效文本');
    return text;
  } catch (e) { if (controller.signal.aborted) throw new Error('AI 请求超时，请重试'); throw e; } finally { clearTimeout(timer); }
}
export function parseArticle(raw: string, targets: string[]): Article {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: unknown; try { data = JSON.parse(clean); } catch { throw new Error('文章必须是有效 JSON'); }
  if (!record(data)) throw new Error('文章格式无效');
  const a = { id: uuid(), title: data.title, paragraphs: data.paragraphs, questions: data.questions, targets: [...targets], createdAt: Date.now() };
  validateArticle(a); return a;
}
export function reviewEntry(entry: Entry, rating: 'forgot' | 'hard' | 'good', now = Date.now()): Entry {
  if (!['forgot', 'hard', 'good'].includes(rating) || !number(now) || !number(entry.interval)) throw new Error('复习参数无效');
  // Intervals are days; forgotten cards return in ten minutes.
  const interval = rating === 'forgot' ? 0 : rating === 'hard' ? Math.max(1, Math.round(entry.interval * 1.2)) : Math.max(1, Math.round(entry.interval * 2.5));
  return { ...entry, interval, due: now + (rating === 'forgot' ? 600000 : interval * 86400000) };
}
export function makeCloze(entry: Entry): string | null {
  if (!entry.context.trim() || !entry.text.trim()) return null;
  const escaped = entry.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
  if (!pattern.test(entry.context)) return null;
  pattern.lastIndex = 0; return entry.context.replace(pattern, '_____');
}
const definitionMarker = '__WORDKEEP_ENGLISH_DEFINITION__';
const legacyDefinitionPattern = () => new RegExp(`^${definitionMarker}\n([\\s\\S]*?)(?:\\n${definitionMarker}\\n|$)`);
const legacyDefinitionBlockPattern = () => new RegExp(`^${definitionMarker}\n[\\s\\S]*?(?:\\n${definitionMarker}\\n|$)`);
/** The structured field wins; older builds packed the definition into notes behind a marker. */
export function definitionOf(entry: Entry): string {
  const field = (entry.englishDefinition || '').trim();
  return field || ((entry.notes || '').match(legacyDefinitionPattern())?.[1] || '').trim();
}
/** User-facing notes without the legacy packed definition block. */
export function notesOf(entry: Entry): string {
  return (entry.notes || '').replace(legacyDefinitionBlockPattern(), '').trim();
}
/** Accepts structured AI JSON; plain provider text becomes the Chinese translation only. */
export function parseTranslationResult(raw: string): Pick<Entry, 'englishDefinition' | 'translation' | 'notes' | 'phonetic'> {
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  if (candidate) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const result = value as Record<string, unknown>;
        if (['englishDefinition', 'translation', 'usage'].some(key => key in result)) {
          return {
            englishDefinition: typeof result.englishDefinition === 'string' ? result.englishDefinition : '',
            translation: typeof result.translation === 'string' ? result.translation : '',
            notes: typeof result.usage === 'string' ? result.usage : '',
            phonetic: cleanPhonetic(result.phonetic),
          };
        }
      }
    } catch { /* Legacy providers may return ordinary text. */ }
  }
  return { englishDefinition: '', translation: raw.trim(), notes: '', phonetic: '' };
}
