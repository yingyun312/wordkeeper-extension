# 隐私说明 / Privacy Policy

拾语 · WordKeeper 是一个本地优先的浏览器扩展。默认情况下，学习数据只保存在当前浏览器中。

## 保存哪些数据

扩展会保存用户主动收藏或手动添加的：

- 英文原文
- 中文与英文释义
- 音标、难度、话题、标签和个人笔记
- 网页来源标题与链接
- 复习进度
- AI 生成的文章与练习题

这些数据保存在浏览器扩展的 IndexedDB 中。

## 何时会发送数据

只有用户主动执行以下操作时，扩展才会把必要文本发送到用户自己配置的 AI 服务：

- 收藏后自动翻译
- 编辑词句时生成释义
- 一键补全分类与音标
- 生成阅读材料
- 测试 API 连接

发送内容通常包括选中的英文及相关上下文、目标词句列表。扩展不会自动上传整页网页、浏览历史或其他网站数据。

AI 服务由用户自行配置（任何兼容 OpenAI Chat Completions 的接口）。该服务如何存储和处理数据，取决于服务提供方的隐私政策，本项目无法控制。

## API Key

- 默认只保存在当前浏览器会话中。
- 用户可以选择“在此设备记住密钥”，此时密钥会写入浏览器扩展的本地存储。该存储不是加密保险箱。
- 密钥不会写入导出备份、网页 DOM、内容脚本或本项目的远程服务。

## 权限用途

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置和 API Key |
| `contextMenus` | 提供右键收藏入口 |
| `scripting` / `activeTab` | 在用户操作时读取当前选区上下文 |
| 页面访问权限（http/https） | 在网页中显示“收藏并翻译”浮动按钮 |
| 可选的 API 主机权限 | 仅在用户配置并授权后调用 AI 服务 |

## 数据删除

- 可在学习库中删除单条或多条记录。
- 可在设置中导出 JSON 备份。
- 卸载扩展通常会删除其本地数据，请在卸载前备份。

## 发音功能

发音使用浏览器内置的 Web Speech API。发音文本不会发送到本项目或额外的语音服务；具体实现由浏览器和操作系统决定。

## 联系方式

如有隐私相关问题，请在项目仓库中提交 Issue。

---

## English summary

WordKeeper stores collected vocabulary, notes, review progress, and generated articles locally in the browser. Text is sent to a user-configured OpenAI-compatible API only when the user explicitly triggers translation, classification, reading generation, or a connection test. API keys are kept in browser session storage by default and are never included in exported backups. The project operates no remote server.
