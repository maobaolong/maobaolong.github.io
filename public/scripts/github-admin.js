import {
  clearStoredSession,
  getActiveSession,
  githubJson,
  startDeviceFlowLogin
} from "./github-auth.js";

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function decodeBase64Utf8(value) {
  return decodeURIComponent(
    Array.from(atob(value.replace(/\n/g, "")))
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
}

function encodeBase64Utf8(value) {
  return btoa(
    encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, pair) =>
      String.fromCharCode(Number.parseInt(pair, 16))
    )
  );
}

function yamlString(value) {
  return JSON.stringify(value || "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loginHintMarkup(device) {
  if (!device) {
    return "";
  }

  return `
    <div class="notice">
      请在新打开的 GitHub 页面完成授权，并输入验证码 <code>${escapeHtml(device.user_code)}</code>。
      如果没有弹出新页面，可以直接打开 <code>${escapeHtml(device.verification_uri)}</code>。
    </div>
  `;
}

function serializePost(post) {
  const frontmatter = [
    "---",
    `title: ${yamlString(post.title)}`,
    `description: ${yamlString(post.description)}`,
    `publishedAt: ${post.publishedAt || new Date().toISOString().slice(0, 10)}`,
    post.updatedAt ? `updatedAt: ${post.updatedAt}` : null,
    `category: ${yamlString(post.category)}`,
    "tags:",
    ...(post.tags || []).map((tag) => `  - ${yamlString(tag)}`),
    `author: ${yamlString(post.author || "毛宝龙")}`,
    `readingTime: ${yamlString(post.readingTime || "6 min")}`,
    `featured: ${Boolean(post.featured)}`,
    `draft: ${Boolean(post.draft)}`,
    "---",
    post.body || ""
  ]
    .filter(Boolean)
    .join("\n");

  return `${frontmatter.trimEnd()}\n`;
}

function parsePost(raw, slug) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = match ? match[1] : "";
  const body = match ? match[2] : raw;
  const lines = frontmatter.split("\n");
  const data = {
    slug,
    title: "",
    description: "",
    publishedAt: "",
    updatedAt: "",
    category: "",
    tags: [],
    author: "毛宝龙",
    readingTime: "6 min",
    featured: false,
    draft: false,
    body
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("tags:")) {
      const tags = [];
      let tagIndex = index + 1;
      while (tagIndex < lines.length && lines[tagIndex].startsWith("  - ")) {
        tags.push(lines[tagIndex].slice(4).replace(/^"(.*)"$/, "$1"));
        tagIndex += 1;
      }
      data.tags = tags;
      index = tagIndex - 1;
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");

    if (key === "featured" || key === "draft") {
      data[key] = value === "true";
    } else if (key in data) {
      data[key] = value;
    }
  }

  return data;
}

class GitHubAdminApp {
  constructor(root) {
    this.root = root;
    this.config = {
      owner: root.dataset.owner,
      repo: root.dataset.repo,
      branch: root.dataset.branch,
      clientId: root.dataset.clientId,
      scope: root.dataset.scope,
      authBaseUrl: root.dataset.authBaseUrl
    };
    this.session = null;
    this.posts = [];
    this.currentPost = null;
    this.currentPostSha = "";
    this.currentPostPath = "";
    this.configFiles = [];
    this.threadMap = [];
    this.threadMapMeta = null;
    this.pendingDevice = null;
    this.status = "";
    this.error = "";
  }

  async init() {
    this.session = await getActiveSession();
    await this.loadInitialData();
    this.render();
  }

  async loadInitialData() {
    if (!this.session) {
      return;
    }

    try {
      this.posts = await this.fetchPosts();
      this.configFiles = await this.fetchConfigFiles();
      await this.fetchThreadMap();
      if (!this.currentPost && this.posts[0]) {
        await this.openPost(this.posts[0].path);
      }
      this.status = "已同步仓库内容。";
      this.error = "";
    } catch (error) {
      this.error = error.message || String(error);
    }
  }

  async github(url, options = {}) {
    if (!this.session?.accessToken) {
      throw new Error("请先登录 GitHub。");
    }

    return githubJson(url, {
      ...options,
      token: this.session.accessToken,
      accept: options.accept || "application/vnd.github+json"
    });
  }

  async login() {
    try {
      this.pendingDevice = null;
      this.error = "";
      this.render();
      this.session = await startDeviceFlowLogin(this.config, {
        onCode: (device) => {
          this.pendingDevice = device;
          this.render();
        }
      });
      this.pendingDevice = null;
      await this.loadInitialData();
      this.render();
    } catch (error) {
      this.pendingDevice = null;
      this.error = error.message || String(error);
      this.render();
    }
  }

  logout() {
    clearStoredSession();
    this.session = null;
    this.posts = [];
    this.currentPost = null;
    this.currentPostSha = "";
    this.currentPostPath = "";
    this.configFiles = [];
    this.threadMap = [];
    this.threadMapMeta = null;
    this.pendingDevice = null;
    this.status = "";
    this.error = "";
    this.render();
  }

  async fetchPosts() {
    const listing = await this.github(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/src/content/blog?ref=${this.config.branch}`
    );

    return listing
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        slug: entry.name.replace(/\.md$/, ""),
        sha: entry.sha
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }

  async fetchConfigFiles() {
    const paths = [
      "src/config/site.json",
      "src/config/home.json",
      "src/config/about.json",
      "src/config/navigation.json"
    ];

    const files = [];
    for (const path of paths) {
      const file = await this.github(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${this.config.branch}`
      );
      files.push({
        name: path.split("/").pop(),
        path,
        sha: file.sha,
        content: decodeBase64Utf8(file.content)
      });
    }

    return files;
  }

  async fetchThreadMap() {
    const file = await this.github(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/src/config/comment-threads.json?ref=${this.config.branch}`
    );
    this.threadMapMeta = { path: file.path, sha: file.sha };
    this.threadMap = JSON.parse(decodeBase64Utf8(file.content));
  }

  async saveThreadMap(message) {
    const saved = await this.github(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${this.threadMapMeta.path}`,
      {
        method: "PUT",
        body: {
          message,
          content: encodeBase64Utf8(`${JSON.stringify(this.threadMap, null, 2)}\n`),
          sha: this.threadMapMeta.sha,
          branch: this.config.branch
        }
      }
    );

    this.threadMapMeta.sha = saved.content.sha;
  }

  async openPost(path) {
    const file = await this.github(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${this.config.branch}`
    );
    const slug = path.split("/").pop().replace(/\.md$/, "");
    this.currentPost = parsePost(decodeBase64Utf8(file.content), slug);
    this.currentPostSha = file.sha;
    this.currentPostPath = path;
    this.render();
  }

  newPost() {
    const today = new Date().toISOString().slice(0, 10);
    this.currentPost = {
      slug: "",
      title: "",
      description: "",
      publishedAt: today,
      updatedAt: today,
      category: "Engineering",
      tags: [],
      author: "毛宝龙",
      readingTime: "6 min",
      featured: false,
      draft: false,
      body: ""
    };
    this.currentPostSha = "";
    this.currentPostPath = "";
    this.render();
  }

  bindCommonActions() {
    this.root.querySelector(".admin-login")?.addEventListener("click", async () => {
      await this.login();
    });

    this.root.querySelector(".admin-logout")?.addEventListener("click", () => {
      this.logout();
    });

    this.root.querySelector(".admin-refresh")?.addEventListener("click", async () => {
      await this.loadInitialData();
      this.render();
    });

    this.root.querySelector(".admin-new-post")?.addEventListener("click", () => {
      this.newPost();
    });
  }

  bindLoggedInActions() {
    this.root.querySelectorAll("[data-open-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        await this.openPost(button.dataset.openPost);
      });
    });

    this.root.querySelector(".admin-post-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.savePost();
    });

    this.root.querySelector(".admin-delete-post")?.addEventListener("click", async () => {
      await this.deletePost();
    });

    this.root.querySelectorAll(".config-file-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this.saveConfigFile(form.dataset.path);
      });
    });
  }

  getCurrentPostFromForm() {
    const form = this.root.querySelector(".admin-post-form");
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const slug = String(formData.get("slug") || "").trim() || slugify(title);

    return {
      slug,
      title,
      description: String(formData.get("description") || "").trim(),
      publishedAt: String(formData.get("publishedAt") || "").trim(),
      updatedAt: String(formData.get("updatedAt") || "").trim(),
      category: String(formData.get("category") || "").trim(),
      tags: String(formData.get("tags") || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      author: String(formData.get("author") || "").trim(),
      readingTime: String(formData.get("readingTime") || "").trim(),
      featured: formData.get("featured") === "on",
      draft: formData.get("draft") === "on",
      body: String(formData.get("body") || "")
    };
  }

  async savePost() {
    try {
      const post = this.getCurrentPostFromForm();
      if (!post.title || !post.slug) {
        throw new Error("标题和 slug 不能为空。");
      }

      const path = `src/content/blog/${post.slug}.md`;
      const previousSlug =
        this.currentPostPath && this.currentPost ? this.currentPost.slug : "";
      const previousPath = this.currentPostPath;
      const previousSha = this.currentPostSha;
      const existing = this.posts.find((item) => item.path === path);
      const payload = {
        message: existing
          ? `chore: update post ${post.slug}`
          : `feat: add post ${post.slug}`,
        content: encodeBase64Utf8(serializePost(post)),
        branch: this.config.branch
      };

      if (existing?.sha) {
        payload.sha = existing.sha;
      } else if (this.currentPostSha && this.currentPostPath === path) {
        payload.sha = this.currentPostSha;
      }

      if (previousPath && previousPath !== path && previousSha) {
        await this.github(
          `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${previousPath}`,
          {
            method: "DELETE",
            body: {
              message: `chore: remove old slug for ${previousSlug}`,
              sha: previousSha,
              branch: this.config.branch
            }
          }
        );
      }

      const saved = await this.github(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}`,
        {
          method: "PUT",
          body: payload
        }
      );

      await this.syncThreadForPost(previousSlug, post.slug);
      this.status = `文章 ${post.slug} 已保存，GitHub Pages 会自动重新部署。`;
      this.error = "";
      this.currentPost = post;
      this.currentPostSha = saved.content.sha;
      this.currentPostPath = path;
      this.posts = await this.fetchPosts();
      this.render();
    } catch (error) {
      this.error = error.message || String(error);
      this.render();
    }
  }

  async ensureThread(slug) {
    const key = `/blog/${slug}/`;
    if (this.threadMap.some((item) => item.key === key)) {
      return;
    }

    const issue = await this.github(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues`,
      {
        method: "POST",
        body: {
          title: `Thread: ${key}`,
          body: `Comment thread for ${key}.\n\n<!-- site-thread:${key} -->`,
          labels: ["site-thread", "article-comments"]
        }
      }
    );

    this.threadMap.push({
      key,
      issueNumber: issue.number,
      kind: "article"
    });

    await this.saveThreadMap(`chore: update comment thread map for ${slug}`);
  }

  async syncThreadForPost(previousSlug, nextSlug) {
    const nextKey = `/blog/${nextSlug}/`;
    if (!previousSlug || previousSlug === nextSlug) {
      await this.ensureThread(nextSlug);
      return;
    }

    const previousKey = `/blog/${previousSlug}/`;
    const existing = this.threadMap.find((item) => item.key === previousKey);

    if (existing) {
      existing.key = nextKey;
      await this.saveThreadMap(
        `chore: rename comment thread map from ${previousSlug} to ${nextSlug}`
      );
      return;
    }

    await this.ensureThread(nextSlug);
  }

  async deletePost() {
    if (!this.currentPostPath || !this.currentPostSha) {
      return;
    }

    try {
      await this.github(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${this.currentPostPath}`,
        {
          method: "DELETE",
          body: {
            message: `chore: delete post ${this.currentPost.slug}`,
            sha: this.currentPostSha,
            branch: this.config.branch
          }
        }
      );

      this.threadMap = this.threadMap.filter(
        (item) => item.key !== `/blog/${this.currentPost.slug}/`
      );
      await this.saveThreadMap(
        `chore: remove comment thread map for ${this.currentPost.slug}`
      );
      this.posts = await this.fetchPosts();
      this.currentPost = null;
      this.currentPostSha = "";
      this.currentPostPath = "";
      this.status = "文章已删除。";
      this.error = "";
      this.render();
    } catch (error) {
      this.error = error.message || String(error);
      this.render();
    }
  }

  async saveConfigFile(path) {
    try {
      const textarea = this.root.querySelector(`[data-config-editor="${path}"]`);
      const parsed = JSON.parse(textarea.value);
      const file = this.configFiles.find((item) => item.path === path);
      const saved = await this.github(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${path}`,
        {
          method: "PUT",
          body: {
            message: `chore: update ${path.split("/").pop()}`,
            content: encodeBase64Utf8(`${JSON.stringify(parsed, null, 2)}\n`),
            sha: file.sha,
            branch: this.config.branch
          }
        }
      );

      file.sha = saved.content.sha;
      file.content = `${JSON.stringify(parsed, null, 2)}\n`;
      this.status = `${path.split("/").pop()} 已保存。`;
      this.error = "";
      this.render();
    } catch (error) {
      this.error = error.message || String(error);
      this.render();
    }
  }

  renderLogin() {
    return `
      <div class="admin-auth">
        <span class="chip">GitHub Login</span>
        <h3>使用 GitHub 登录后台</h3>
        <p>登录后可以直接创建文章、编辑首页配置，并自动同步到仓库。</p>
        <div class="button-row">
          <button class="button button-primary admin-login">开始登录</button>
        </div>
        ${loginHintMarkup(this.pendingDevice)}
      </div>
    `;
  }

  renderApp() {
    const post = this.currentPost;
    const postList = this.posts
      .map(
        (item) => `
          <button class="admin-post-item${this.currentPostPath === item.path ? " is-active" : ""}" data-open-post="${escapeHtml(item.path)}">
            <strong>${escapeHtml(item.slug)}</strong>
            <span>${escapeHtml(item.name)}</span>
          </button>
        `
      )
      .join("");

    const configEditors = this.configFiles
      .map(
        (file) => `
          <form class="config-file-form glass" data-path="${escapeHtml(file.path)}">
            <div class="admin-section-head">
              <h3>${escapeHtml(file.name)}</h3>
              <button class="button button-secondary" type="submit">保存 ${escapeHtml(file.name)}</button>
            </div>
            <textarea class="admin-json-editor" data-config-editor="${escapeHtml(file.path)}" rows="14">${escapeHtml(file.content)}</textarea>
          </form>
        `
      )
      .join("");

    return `
      <div class="admin-toolbar">
        <div class="github-user">
          <img src="${escapeHtml(this.session.user.avatarUrl)}" alt="${escapeHtml(this.session.user.login)}" class="github-user__avatar" />
          <div>
            <strong>${escapeHtml(this.session.user.name)}</strong>
            <p>@${escapeHtml(this.session.user.login)}</p>
          </div>
        </div>
        <div class="button-row">
          <button class="button button-secondary admin-refresh">重新同步</button>
          <button class="button button-secondary admin-logout">退出</button>
        </div>
      </div>

      <div class="admin-grid">
        <aside class="admin-sidebar glass">
          <div class="admin-section-head">
            <h3>文章列表</h3>
            <button class="button button-primary admin-new-post" type="button">新建文章</button>
          </div>
          <div class="admin-post-list">${postList || "<p>暂无文章。</p>"}</div>
        </aside>

        <section class="admin-main">
          <form class="admin-post-form glass">
            <div class="admin-section-head">
              <h3>${post ? `编辑文章 · ${post.slug || "未命名"}` : "选择或新建一篇文章"}</h3>
              <div class="button-row">
                <button class="button button-secondary admin-delete-post" type="button"${post ? "" : " disabled"}>删除</button>
                <button class="button button-primary" type="submit"${post ? "" : " disabled"}>保存文章</button>
              </div>
            </div>

            <div class="admin-form-grid">
              <label class="admin-field">
                <span>标题</span>
                <input name="title" value="${escapeHtml(post?.title || "")}" />
              </label>
              <label class="admin-field">
                <span>Slug</span>
                <input name="slug" value="${escapeHtml(post?.slug || "")}" />
              </label>
              <label class="admin-field admin-field--wide">
                <span>描述</span>
                <textarea name="description" rows="3">${escapeHtml(post?.description || "")}</textarea>
              </label>
              <label class="admin-field">
                <span>发布时间</span>
                <input name="publishedAt" value="${escapeHtml(post?.publishedAt || "")}" />
              </label>
              <label class="admin-field">
                <span>更新时间</span>
                <input name="updatedAt" value="${escapeHtml(post?.updatedAt || "")}" />
              </label>
              <label class="admin-field">
                <span>分类</span>
                <input name="category" value="${escapeHtml(post?.category || "")}" />
              </label>
              <label class="admin-field">
                <span>标签（逗号分隔）</span>
                <input name="tags" value="${escapeHtml((post?.tags || []).join(", "))}" />
              </label>
              <label class="admin-field">
                <span>作者</span>
                <input name="author" value="${escapeHtml(post?.author || "毛宝龙")}" />
              </label>
              <label class="admin-field">
                <span>阅读时长</span>
                <input name="readingTime" value="${escapeHtml(post?.readingTime || "6 min")}" />
              </label>
              <label class="admin-checkbox">
                <input type="checkbox" name="featured"${post?.featured ? " checked" : ""} />
                <span>首页精选</span>
              </label>
              <label class="admin-checkbox">
                <input type="checkbox" name="draft"${post?.draft ? " checked" : ""} />
                <span>草稿</span>
              </label>
              <label class="admin-field admin-field--wide">
                <span>正文（Markdown）</span>
                <textarea name="body" rows="16">${escapeHtml(post?.body || "")}</textarea>
              </label>
            </div>
          </form>

          <div class="admin-config-grid">${configEditors}</div>
        </section>
      </div>
    `;
  }

  render() {
    const message = this.error
      ? `<div class="notice notice--danger">${this.error}</div>`
      : this.status
        ? `<div class="notice">${this.status}</div>`
        : "";

    this.root.innerHTML = `
      ${message}
      ${this.session ? this.renderApp() : this.renderLogin()}
    `;

    this.bindCommonActions();
    if (this.session) {
      this.bindLoggedInActions();
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("#admin-app");
  if (root) {
    const app = new GitHubAdminApp(root);
    app.init();
  }
});
