# Maobaolong Tech Blog

一个偏技术发布页风格的个人博客站，包含这些能力：

- 首页采用参考站那种技术产品展示感的视觉风格
- Markdown 技术博客
- `/admin` 后台，支持 GitHub 登录后管理文章与站点配置
- 每篇文章评论与点赞
- 单独留言板页
- GitHub Pages 自动部署

## 技术栈

- Astro: 静态内容站点
- GitHub OAuth Device Flow + Vercel Auth Service: GitHub 登录后台
- GitHub Issues + Reactions: 评论、留言、点赞
- GitHub Actions: 自动部署到 GitHub Pages

## 目录

- `src/content/blog/`: 博客文章
- `src/config/`: 首页、导航、关于页、站点集成配置
- `src/pages/admin/`: GitHub 登录后台
- `public/scripts/`: 登录、评论、后台逻辑
- `auth-service/`: GitHub OAuth 授权中转服务，部署到 Vercel

## 本地启动

```bash
export PATH="/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
pnpm install
pnpm dev
```

## 部署到 GitHub Pages

1. 新建 GitHub 仓库。
2. 如果仓库名是 `maobaolong.github.io`，保持默认 `SITE_URL=https://maobaolong.github.io` 即可。
3. 如果仓库名是普通项目仓库，例如 `tech-blog`：
   - 在 GitHub Actions 里新增变量 `SITE_URL=https://maobaolong.github.io`
   - 新增变量 `BASE_PATH=/tech-blog`
4. 打开仓库 `Settings > Pages`，把 Source 设为 `GitHub Actions`。
5. 推送代码到 `main`，`.github/workflows/deploy.yml` 会自动部署。

## GitHub 登录后台

这个版本使用 GitHub OAuth Device Flow 登录。由于 GitHub Pages 是纯静态托管，而 GitHub 登录接口又不能直接给前端跨域调用，所以当前代码把“申请 device code / 轮询 access token”这层轻量代理放在 `auth-service/`，部署到 Vercel 后供 `/admin/` 和评论组件共用。

### 已有配置

- OAuth App 名称：`Maobaolong Engineering Admin`
- Client ID 写在 `src/config/site.json`
- `authBaseUrl` 也写在 `src/config/site.json`
- 当前生产授权服务地址：`https://maobaolong-auth-maobaolongs-projects.vercel.app`
- `/admin/` 登录后可直接：
  - 新建 / 编辑 / 删除博客文章
  - 自动创建文章对应评论线程
  - 编辑 `site.json`、`home.json`、`about.json`、`navigation.json`

### 注意

- 登录后会向 GitHub 请求 `public_repo read:user`
- 需要先把 `auth-service/` 部署到 Vercel，并配置：
  - `GITHUB_CLIENT_ID`
  - `ALLOWED_ORIGINS=https://maobaolong.github.io,http://127.0.0.1:4321`
- 如果使用 Vercel API 直接上传 `auth-service/`，不要在 `vercel.json` 里手动钉 `@vercel/node` Builder 版本；零配置 Node API 更稳定。
- 只有对仓库有写权限的账号，才能真正保存改动

## 评论、留言板、点赞

评论系统使用 GitHub Issues 和 Reactions，不依赖 giscus app。

### 结构

- 每篇文章对应一个 issue 线程
- 留言板对应一个固定 issue 线程
- 评论写入 issue comments
- 点赞写入 GitHub reactions

### 线程映射

线程映射文件在 `src/config/comment-threads.json`。

当你在 `/admin/` 新建文章并保存时，后台会自动：

1. 把 Markdown 写入 `src/content/blog/`
2. 创建对应 issue 评论线程
3. 更新 `comment-threads.json`
4. 推送到 `master` 并触发 Pages 重建

## 通过后台可管理的内容

- 博客文章
- 首页 Hero、指标卡、技术支柱
- 导航菜单
- 关于页
- GitHub 与联系信息
- 评论线程映射

## 后续你可能会想加

- 中文 / 英文双语
- 文章搜索
- 项目作品集页
- 自定义域名和备案信息
