import { ArrowUpRight, DownloadSimple, GithubLogo, Play, Sparkle } from "@phosphor-icons/react";
import "./product-page.css";
import oceanImage from "./assets/ocean-morning.png";
import appIcon from "./assets/app-icon.png";

const releasesUrl = "https://github.com/loveOneBaby/luma-wallpaper/releases";

export function ProductPage() {
  return (
    <main className="product-page">
      <nav className="product-nav" aria-label="主导航">
        <a className="product-logo" href="#top" aria-label="Luma 首页"><img className="product-logo-icon" src={appIcon} alt="" aria-hidden="true" /><span>Luma</span></a>
        <div className="nav-links"><a href="#why-luma">为什么 Luma</a><a href="#download">下载</a><a href={releasesUrl} target="_blank" rel="noreferrer"><GithubLogo size={18} /> GitHub</a></div>
        <a className="nav-try" href="?app=1"><Play size={16} weight="fill" /> 打开 Web 预览</a>
      </nav>
      <section className="product-hero" id="top">
        <div className="hero-copy"><p className="eyebrow"><Sparkle size={15} weight="fill" /> 你的桌面，应该有自己的风景</p><h1>让喜欢的画面，<em>常驻</em>桌面。</h1><p className="hero-lede">Luma 是一款轻盈的图片与动态壁纸管理器。上传自己的素材，安静地整理、预览，然后让它真正成为你的桌面。</p><div className="hero-actions"><a className="button button-primary" href="?app=1"><Play size={18} weight="fill" /> 立即预览</a><a className="button button-quiet" href={releasesUrl} target="_blank" rel="noreferrer"><DownloadSimple size={19} /> 下载桌面端 <ArrowUpRight size={16} /></a></div><p className="hero-note">支持 macOS · Windows · Web 预览</p></div>
        <div className="hero-art" aria-label="海边动态壁纸预览"><div className="sun-glow" aria-hidden="true" /><img src={oceanImage} alt="海面与晨光" /><div className="art-glass art-status"><span className="live-dot" /> 正在使用</div><div className="art-glass art-caption"><span>ocean-morning.mp4</span><small>动态壁纸 · 01:24</small></div><div className="art-glass art-dock"><span className="dock-icon">◒</span><span className="dock-line" /><span>播放中</span><span className="dock-stop">Ⅱ</span></div></div>
      </section>
      <section className="proof-strip" aria-label="产品特性概览"><span>为自己的素材而生</span><span>·</span><span>轻量 · 私密 · 无干扰</span><span>·</span><span>图片与视频</span></section>
      <section className="why-section" id="why-luma"><div className="section-intro"><p className="eyebrow">LUMA / 01</p><h2>把注意力留给<br /><em>画面本身。</em></h2></div><div className="feature-grid"><article><span className="feature-number">01</span><h3>只管理你的收藏</h3><p>没有素材市场，没有推荐流。Luma 只替你整理已经喜欢的图片和视频。</p></article><article><span className="feature-number">02</span><h3>从预览到桌面</h3><p>在 Web 上安心预览，在 macOS 或 Windows 上一键设置为真正的桌面壁纸。</p></article><article><span className="feature-number">03</span><h3>安静地待在后台</h3><p>动态壁纸在桌面图标之后运行。播放、暂停、静音，都只需要一次点击。</p></article></div></section>
      <section className="download-section" id="download"><div><p className="eyebrow">LUMA / 02</p><h2>从你的下一张壁纸开始。</h2><p>下载桌面端，或者先在浏览器里体验 Luma 的媒体库。</p></div><div className="download-actions"><a className="button button-primary" href={releasesUrl} target="_blank" rel="noreferrer"><DownloadSimple size={19} /> 前往 GitHub 下载</a><a className="text-link" href="?app=1">先试试 Web 预览 <ArrowUpRight size={16} /></a></div></section>
      <footer><a className="product-logo" href="#top"><img className="product-logo-icon" src={appIcon} alt="" aria-hidden="true" /><span>Luma</span></a><span>Made for quiet desktops.</span><a href={releasesUrl} target="_blank" rel="noreferrer">GitHub Releases <ArrowUpRight size={14} /></a></footer>
    </main>
  );
}
