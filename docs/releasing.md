# Windows 发布

项目使用 Electron 包装现有本地编辑器，使用 electron-builder 生成 NSIS 安装包和 Portable EXE。Node.js 与浏览器运行环境随包分发；Codex CLI 与用户认证由用户自行配置。

## 构建与验收

在 Windows x64 上执行：

```powershell
npm ci
npx playwright install chromium
npm test
npm run test:desktop
npm run dist:win
$env:FIGURA_EXE = (Resolve-Path 'release/win-unpacked/Figura SVG Studio.exe').Path
npm run test:desktop
```

检查内容覆盖窗口启动、SVG 导入与改色、保存到磁盘、关闭后恢复项目，以及打包环境中的 PDF 工作线程、原生画布依赖和 CLI 脚本调用。AI 传输使用测试替身；这项检查不代表真实模型生成质量。编辑器原有自动化另行覆盖选择范围、文件冲突、导入清理、AI 预览、取消与撤销等流程。

发布资产为两个 EXE、介绍视频及 SHA-256 校验文件。构建目录与本机测试材料不纳入 Git。

## 媒体

`docs/media/hero.svg` 和 `concept.svg` 是可编辑的矢量图。截图与介绍视频来自项目自带示例，未使用用户论文或个人项目。

运行 `node scripts/record-demo.mjs` 可重新录制界面；输出 WebM 后可用 FFmpeg 转成 H.264 MP4，并生成 GIF 预览。视频在字幕中明确说明没有发起真实模型请求。

## 桌面约定

- 桌面使用固定的本地来源 `http://127.0.0.1:14317`，保证 IndexedDB 历史记录在启动之间可恢复。
- 默认磁盘目录为系统「文档」下的 `Figura`，应用数据存放在 Electron 的用户数据目录。
- `FIGURA_PORT` 可指定备用固定端口；更改端口会使用新的浏览器存储来源。
- `FIGURA_USER_DATA` 可指定隔离的用户数据目录，供验收或开发使用。
- 窗口启用 renderer sandbox 与 context isolation，关闭 Node integration；仅加载本机编辑器。
- 退出时关闭本地服务和连接，使正在处理的请求收到取消信号。
- 当前产物未签名，没有自动更新；后续版本由 GitHub Releases 下载。

## 依赖审计记录

2026-10-12 的生产依赖审计报告 `mammoth → argparse → sprintf-js` 链上的中等级别告警（精度格式字符串可触发拒绝服务，GHSA-hp3w-g68c-fv3c）。npm 建议退回不兼容的旧版 mammoth，故本轮没有强制降级。告警仍未消除，后续在上游兼容修复后更新；此发布不宣称依赖审计零告警。

## v1.0.0 验收记录

2026-10-12 在 Windows 11 x64 完成：12 项服务端检查与 25 项浏览器检查全部通过；源码桌面窗口、打包后应用、实际 NSIS 安装后的应用均通过桌面检查。安装器静默安装退出码为 0。Portable EXE 另行验证实际解压启动、导入与改色。Windows 10 为目标平台，本轮未在 Windows 10 实机复测。
