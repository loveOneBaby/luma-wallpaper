# Luma 部署文档

本文说明如何把 Luma 部署到 GitHub Pages，并发布 macOS、Windows 桌面安装包。

## 一、部署产品页到 GitHub Pages

项目使用 GitHub Actions 自动部署，工作流文件为 `.github/workflows/pages.yml`。

### 自动部署

将代码推送到 `main` 分支即可触发：

```bash
git add .
git commit -m "describe your change"
git push origin main
```

工作流会依次执行：

1. 安装依赖
2. 运行依赖审计、测试和 lint
3. 构建 Vite Web 产物
4. 上传 `dist` 为 Pages 构建产物
5. 发布到 GitHub Pages

依赖审计结果会作为提示保留，不会阻断 Pages 发布；生产构建、测试或 lint 失败仍会阻止部署。

### 访问地址

默认地址为：

<https://loveonebaby.github.io/luma-wallpaper/>

产品页首页是默认入口。浏览器内的壁纸管理器预览使用：

<https://loveonebaby.github.io/luma-wallpaper/?app=1>

### GitHub 仓库设置

首次启用时，在仓库中打开：

`Settings` → `Pages` → `Build and deployment`

将 `Source` 设为 `GitHub Actions`，然后推送一次 `main`。之后可在 `Actions` → `Web CI and GitHub Pages` 查看部署状态。

## 二、发布桌面端安装包

桌面端通过 GitHub Release 发布。发布版本前，先确认：

- `package.json` 中的 `version` 已更新
- `main` 分支的 Web CI 已通过
- 本地测试和构建已通过

```bash
npm ci
npm test
npm run lint
npm run build
```

创建与 `package.json` 版本一致的标签并推送：

```bash
git tag v0.2.6
git push origin v0.2.6
```

推送 `v*` 标签后，`.github/workflows/release.yml` 会构建并发布：

- macOS Apple Silicon：DMG、ZIP
- macOS Intel：DMG、ZIP
- Windows x64：NSIS 安装程序
- 各平台自动更新所需的 `latest*.yml` 和 blockmap 文件

下载地址：

<https://github.com/loveOneBaby/luma-wallpaper/releases>

## 三、签名与公证

没有配置签名凭据时，流水线仍会生成未签名安装包：

- macOS 首次打开可能需要在系统安全设置中允许
- Windows 可能显示“未知发布者”
- 未签名版本不具备发布者身份校验

macOS 签名与公证需要配置以下 GitHub Actions Secrets：

```text
MAC_CSC_LINK
MAC_CSC_KEY_PASSWORD
APPLE_API_KEY
APPLE_API_KEY_ID
APPLE_API_ISSUER
APPLE_TEAM_ID
```

Windows Authenticode 签名需要：

```text
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

正式公开分发建议同时配置 macOS Developer ID、公证和 Windows Authenticode 签名。

## 四、常见问题

### Pages 仍显示旧页面

1. 打开 `Actions`，确认 `Web CI and GitHub Pages` 已成功
2. 等待 GitHub Pages 完成缓存更新
3. 浏览器执行强制刷新
4. 确认访问地址没有带 `?app=1`

### Pages 工作流失败

优先检查失败步骤：

- `Build web app`：检查 Vite 构建错误
- `Run tests`：检查 Node 测试失败
- `Lint`：检查 ESLint 错误
- `Deploy Web to GitHub Pages`：检查仓库 Pages Source 是否为 GitHub Actions

### 桌面端没有出现在 Releases

确认标签符合 `v*` 格式，并且标签版本与 `package.json` 的 `version` 完全一致，例如 `package.json` 为 `0.2.6` 时使用 `v0.2.6`。

### Web 端能否设置系统壁纸

不能。Web 端只负责上传、分类、收藏和预览；真正设置系统壁纸必须下载 macOS 或 Windows 桌面端。

## 五、本地验证

启动 Web 开发服务器：

```bash
npm run dev
```

生产构建和本地预览：

```bash
npm run build
npm run preview
```

桌面端开发：

```bash
npm run desktop:dev
```
