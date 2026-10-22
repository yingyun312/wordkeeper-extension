import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {listEntries, type Entry} from './core';
import './style.css';

function openApp(path = '') {
  void chrome.tabs.create({url: `${chrome.runtime.getURL('index.html')}${path}`});
}

function Popup() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void listEntries().then(setEntries).catch(() => setError('暂时无法读取学习数据'));
  }, []);
  const due = entries.filter(entry => entry.due <= Date.now()).length;
  const untranslated = entries.filter(entry => !entry.translation.trim()).length;
  return <main className="popup-shell">
    <div className="popup-brand"><div className="brand">拾语 <small>WORDKEEPER</small></div><span>本地学习空间</span></div>
    <h1>今天学一点，<br />把喜欢的英文留下来。</h1>
    <p className="popup-intro">从网页收藏表达，在合适的时候再次遇见。</p>
    {error && <p className="popup-error" role="status">{error}</p>}
    <div className="popup-stats"><button onClick={() => openApp('?page=review')}><strong>{due}</strong><span>今日复习</span></button><button onClick={() => openApp('?page=untranslated')}><strong>{untranslated}</strong><span>待翻译</span></button></div>
    <button className="primary popup-main-action" onClick={() => openApp()}>打开学习库 <span>→</span></button>
    <button className="popup-settings" onClick={() => openApp('?page=settings')}>设置 API 与备份 <span>↗</span></button>
    <p className="popup-footnote">数据保存在此浏览器 · 不会自动上传</p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup />);
