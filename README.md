<p align="center">
  <img src="./build/icon.png" width="112" height="112" alt="Luma icon" />
</p>

<h1 align="center">Luma Wallpaper</h1>

<p align="center">清新、简约的图片与动态视频壁纸管理器，支持 macOS、Windows 和 Web 预览。</p>

<p align="center">
  <a href="https://github.com/loveOneBaby/luma-wallpaper/actions/workflows/release.yml"><img src="https://github.com/loveOneBaby/luma-wallpaper/actions/workflows/release.yml/badge.svg" alt="Build and Release" /></a>
  <a href="https://github.com/loveOneBaby/luma-wallpaper/releases"><img src="https://img.shields.io/github/package-json/v/loveOneBaby/luma-wallpaper" alt="Version" /></a>
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
- Windows x64：`Luma-<version>-x64-Setup.exe` NSIS 安装程序
- Web：静态构建 ZIP

也可以在 [Build and Release](https://github.com/loveOneBaby/luma-wallpaper/actions/workflows/release.yml) 页面手动运行流水线，并从对应运行记录下载构建产物。

> 未配置签名凭据的公开构建不会进行 Apple Developer 公证或商业代码签名。macOS 首次打开时可能需要在系统安全设置中确认，Windows 也可能显示未知发布者提示。流水线会清楚标记未签名产物；正式公开分发仍建议配置 macOS Developer ID、公证和 Windows Authenticode 签名。

## 本地开发

```bash
npm ci
npm test
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

## Web 部署

`.github/workflows/pages.yml` 会在 pull request 上执行依赖审计、测试、lint 和生产构建；推送到 `main` 后还会把 `dist` 发布到 GitHub Pages。

仓库已启用 GitHub Actions 作为 Pages 发布源，页面地址为：

<https://loveonebaby.github.io/luma-wallpaper/>

## 桌面端自动发布

推送与 `package.json` 版本一致的 `v*` 标签会构建全部平台，并把产物与更新清单发布到源仓库的 [GitHub Releases](https://github.com/loveOneBaby/luma-wallpaper/releases)（用 `GITHUB_TOKEN` 即可，无需额外令牌）。桌面端自动更新通过 electron-updater 的 `github` provider 查询源仓库的 `latest*.yml`。

```bash
git tag v0.2.0
git push origin v0.2.0
```

不要在仅修改版本号前提前创建标签；先等待 `main` 的 Web CI 通过，再推送标签。手动运行 `Build and Release` 会生成可下载的桌面端 Actions Artifacts，但不会创建 Release。桌面发布复用已经通过测试的 renderer 产物，不会在三个系统上重复构建前端。

流水线会同时发布 Windows `latest.yml`、macOS 分架构更新清单和差分下载 blockmap，并在上传前校验清单中的每个 URL、文件大小和 SHA-512。Release 创建后还会通过 GitHub API、HTTP 下载地址和 GitHub SHA-256 digest 再验证一次。

macOS 签名与公证凭据是可选的。完整配置以下 6 项会签名并公证（mac 自动更新随之具备完整性校验）；全部留空则发布未签名版（mac 仍会尝试自动更新——运行时签名门禁已移除，但未签名更新无完整性校验，自分发场景可用）；只配置其中几项会直接失败：

- `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY`（`.p8` 文件的 Base64 内容）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_TEAM_ID`

Windows Authenticode 签名同样可选，正式分发时强烈建议配置：

- `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`

未配置 Windows 证书时，流水线会保留构建并标记为“未知发布者”；只配置其中一项会直接失败，避免误以为产物已签名。

`v0.1.2` 及更早版本本身没有更新模块，需要手动安装一次带更新模块的版本。现有未签名 macOS 客户端无法自动迁移到首个 Developer ID 签名版本，首个签名版仍需用户手动安装一次；此后的签名版本才能安全地自动更新。Windows 从具备更新模块的版本起，可以直接发现并安装修正后的更新清单。

打包时还会关闭 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS` 和调试 CLI 入口，并启用 Cookie 加密、ASAR 完整性校验和仅从 `app.asar` 加载应用代码。

## 技术栈

- React 19 + Vite
- Electron 43 + electron-builder
- React Bits 风格 GlassSurface SVG 位移滤镜
- macOS desktop window / Windows WorkerW 动态壁纸层

Windows WorkerW 实现的第三方来源与许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
