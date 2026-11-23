# 拍一拍设置页（预览，不并主线）

这是本机验证「别人拍她时回话/回拍概率」用的设置页源码，**只放预览分支**，不打算并进 `main`：

- 仓库规范是 UI 落 `launcher/`（WPF），内核不提供静态网页，所以 PR #209 只提交了 `config.json` 的 `pat.*` 四个键。
- `pat-route.js`：验证用的内核路由（`GET /pat` + `/pat/app.css` + `/pat/app.js` + `GET/POST /api/pat`），依赖 PR #209 的 `pat.*` 配置与 `applyConfigPatch`。
- `screenshot.png`：页面实际渲染。

如果这个方向可以，我可以按 `launcher/Views/BridgePage.xaml(.cs)` 的现有样式补 WPF 控件（开关 + 两个概率 + 间隔/上限），只提交源码，EXE 由维护者发布。
