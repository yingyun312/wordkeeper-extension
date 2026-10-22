// @vitest-environment jsdom
// The floating button lives in a closed shadow root, so the test captures the root at creation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalAttachShadow = Element.prototype.attachShadow;
const sendMessage = vi.fn();
let shadowRoot: ShadowRoot;

function selectParagraph(text: string): void {
  const paragraph = document.createElement('p');
  paragraph.textContent = `They said ${text} out loud.`;
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  sendMessage.mockResolvedValue({ ok: true, entry: { id: 'entry-1' } });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  // jsdom does not implement range geometry; a real browser always provides it.
  (Range.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }) as DOMRect;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = originalAttachShadow.call(this, init) as ShadowRoot;
    shadowRoot = root;
    return root;
  };
  document.body.innerHTML = '';
  // @ts-expect-error the content script runs for its side effects and has no exports
  await import('./content');
});

afterEach(() => {
  Element.prototype.attachShadow = originalAttachShadow;
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

describe('floating save button', () => {
  it('re-enables itself for every new selection so the next text can be saved', async () => {
    selectParagraph('apple');
    await tick();
    const button = shadowRoot.querySelector('button')!;
    expect(button.textContent).toBe('收藏并翻译');
    expect(button.disabled).toBe(false);
    button.click();
    await tick();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('已收藏 · 正在翻译');

    selectParagraph('banana');
    await tick();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('收藏并翻译');
    button.click();
    await tick();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save-and-translate', text: expect.stringContaining('banana') }));
  });

  it('shows the failure reason and allows an immediate retry', async () => {
    sendMessage.mockResolvedValueOnce({ ok: false, error: '数据库被其他页面阻塞' });
    selectParagraph('apple');
    await tick();
    const button = shadowRoot.querySelector('button')!;
    button.click();
    await tick();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('失败：');
    expect(button.title).toContain('数据库被其他页面阻塞');
    button.click();
    await tick();
    expect(button.textContent).toBe('已收藏 · 正在翻译');
  });

  it('reports duplicates instead of pretending the text was saved again', async () => {
    sendMessage.mockResolvedValueOnce({ ok: false, error: '该文本已收藏（重复）' });
    selectParagraph('apple');
    await tick();
    const button = shadowRoot.querySelector('button')!;
    button.click();
    await tick();
    expect(button.textContent).toBe('已在学习库中');
    expect(button.disabled).toBe(false);
  });

  it('hides the button when the selection disappears', async () => {
    selectParagraph('apple');
    await tick();
    const host = shadowRoot.host as HTMLElement;
    expect(host.style.display).toBe('block');
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    expect(host.style.display).toBe('none');
  });
});
