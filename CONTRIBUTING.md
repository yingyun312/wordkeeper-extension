# 参与贡献

感谢你愿意改进拾语 · WordKeeper。

## 开发环境

```bash
npm install
npm run dev
npm test
npm run build
```

加载扩展：

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 加载项目中的 `dist` 目录

## 提交前检查

- `npm test` 全部通过
- `npm run build` 通过
- 不提交 API Key、个人学习数据或 `.env`
- 新增交互尽量补充对应测试
- 保持界面文案简洁、中文优先

## 提交 Issue

请说明：

- 使用的浏览器和版本
- 扩展版本（学习库右下角）
- 复现步骤
- 预期结果与实际结果
- 错误信息或截图（请先移除个人信息）

## Pull Request

- 一个 PR 尽量只解决一个问题
- 说明改动原因和行为变化
- 涉及 UI 时附截图
- 不要重写无关代码或调整无关格式

## 安全

如果发现安全问题，请不要在公开 Issue 中发布可利用细节，先通过仓库提供的私密联系方式联系维护者。
