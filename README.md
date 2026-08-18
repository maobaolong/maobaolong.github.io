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
- Decap CMS: Git 驱动后台
- giscus: 基于 GitHub Discussions 的评论、留言、点赞
- GitHub Actions: 自动部署到 GitHub Pages
- Cloudflare Worker: Decap CMS 的 GitHub OAuth 代理

## 目录

- `src/content/blog/`: 博客文章
- `src/config/`: 首页、导航、关于页、站点集成配置
- `public/admin/`: Decap CMS 后台
- `oauth-worker/`: GitHub 登录代理

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
5. 推送代码到 `master`，`.github/workflows/deploy.yml` 会自动部署。

## 配置 GitHub 登录后台

Decap CMS 的 GitHub 后端需要 OAuth 代理，GitHub 登录需要服务端参与认证，外部 OAuth 代理可通过 `backend.base_url` 接入。

### 1. 创建 GitHub OAuth App

到 GitHub Developer Settings 新建 OAuth App：

- Homepage URL: 你的博客线上地址
- Authorization callback URL: 你的 OAuth Worker 地址 + `/callback`

GitHub 的 OAuth App Web flow 会在服务端用 `client_id`、`client_secret` 与授权码换取访问令牌。

### 2. 部署 `oauth-worker/`

推荐用 Cloudflare Worker。Decap 文档明确给出了用 OAuth Proxy 的方式，并指向 Cloudflare Worker 模板。

在 `oauth-worker/` 目录执行：

```bash
pnpm install
pnpm dlx wrangler secret put GITHUB_CLIENT_ID
pnpm dlx wrangler secret put GITHUB_CLIENT_SECRET
pnpm dlx wrangler deploy
```

再设置一个普通变量：

- `ALLOWED_ORIGIN=https://你的博客域名`

### 3. 更新后台配置

编辑 `public/admin/config.yml`：

- `backend.repo`
- `backend.base_url`
- `site_url`
- `display_url`

部署后访问 `/admin/`，就可以用 GitHub 账号登录管理内容。

注意：Decap GitHub 后端要求登录用户对内容仓库有 push 权限。

## 配置评论、留言板、点赞

giscus 把评论和 reactions 存到 GitHub Discussions，不需要单独数据库；仓库需要公开、安装 giscus app，并开启 Discussions。

### 1. 在仓库开启 Discussions

- 仓库设为 public
- 开启 Discussions
- 安装 giscus app

### 2. 在 giscus 站点生成配置

去 giscus 配置页拿到下面这些值，写入 `src/config/site.json`：

- `repo`
- `repoId`
- `category`
- `categoryId`

giscus 会根据你选择的映射方式，把页面和 Discussion 关联起来；如果没有匹配 Discussion，会在第一次评论或 reaction 时自动创建。

### 3. 使用方式

- 文章页默认按 `pathname` 建立评论主题
- `/message-board/` 使用固定 term `guestbook` 作为留言板
- 点赞由 giscus reaction 提供

## 通过后台可管理的内容

- 博客文章
- 首页 Hero、指标卡、技术支柱
- 导航菜单
- 关于页
- GitHub 与联系信息

## 后续你可能会想加

- 中文 / 英文双语
- 文章搜索
- 项目作品集页
- 自定义域名和备案信息
