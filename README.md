<p align="center">
  <img src="./build/icon.png" width="112" height="112" alt="Luma icon" />
</p>

<h1 align="center">Luma Wallpaper</h1>

<p align="center">清新、简约的图片与动态视频壁纸管理器，支持 macOS、Windows 和 Web 预览。</p>

<p align="center">
  <a href="https://github.com/loveOneBaby/luma-wallpaper/actions/workflows/release.yml"><img src="https://github.com/loveOneBaby/luma-wallpaper/actions/workflows/release.yml/badge.svg" alt="Build and Release" /></a>
  <a href="https://github.com/loveOneBaby/luma-wallpaper/releases"><img src="https://img.shields.io/github/v/release/loveOneBaby/luma-wallpaper?display_name=tag" alt="Latest release" /></a>
</p>

## 功能

- 点击选择或拖拽上传自己的图片和视频
- 按全部、图片、视频、收藏分类管理
- 液态玻璃折射界面与响应式布局
- macOS、Windows 图片壁纸设置
- macOS、Windows 桌面层动态视频壁纸
- 壁纸冲突检测、未生效提示与重新应用
- 桌面端自动检测与下载更新，确认后关闭旧版本、安装并重新打开
- Web 端安全预览，不伪装系统壁纸设置能力

## 下载

稳定版本从 [GitHub Releases](https://github.com/loveOneBaby/luma-wallpaper/releases) 下载：

- macOS Apple Silicon：DMG 或 ZIP
- macOS Intel：DMG 或 ZIP
- Windows x64：NSIS 安装程序
- Web：静态构建 ZIP

也可以在 [Build and Release](https://github.com/loveOneBaby/luma-wallpaper/actions/workflows/release.yml) 页面手动运行流水线，并从对应运行记录下载构建产物。

> 当前公开构建未进行 Apple Developer 公证或商业代码签名。macOS 首次打开时可能需要在系统安全设置中确认，Windows 也可能显示未知发布者提示。Windows 自动更新可使用未签名 NSIS 包；macOS 自动更新必须先配置 Developer ID 签名。

## 本地开发

```bash
npm install
npm run dev
```

启动 Electron 桌面端：

```bash
npm run desktop:dev
```

构建当前平台：

```bash
npm run build
npm run desktop:build:mac
npm run desktop:build:win
```

## 自动发布

推送 `v*` 标签会自动构建全部平台并创建 GitHub Release：

```bash
git tag v0.1.3
git push origin v0.1.3
```

普通 `main` 分支推送和手动运行会生成可下载的 Actions Artifacts，但不会自动创建 Release。

流水线会同时发布 Windows `latest.yml`、macOS 分架构更新清单和差分下载 blockmap。若要启用 macOS 自动更新及公证，请在仓库 Actions Secrets 中配置：

- `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY`（`.p8` 文件的 Base64 内容）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_TEAM_ID`

`v0.1.2` 及更早版本本身没有更新模块，需要手动安装一次 `v0.1.3`；从该版本开始，后续版本可由应用内更新。

## 技术栈

- React 19 + Vite
- Electron 43 + electron-builder
- React Bits 风格 GlassSurface SVG 位移滤镜
- macOS desktop window / Windows WorkerW 动态壁纸层

Windows WorkerW 实现的第三方来源与许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
