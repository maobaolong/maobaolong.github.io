import {
  clearStoredSession,
  createSessionFromAccessToken,
  getActiveSession,
  githubJson,
  startDeviceFlowLogin
} from "./github-auth.js";

function formatDate(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderUserBadge(session) {
  if (!session?.user) {
    return `
      <div class="github-user">
        <span class="chip">Guest</span>
        <p>登录 GitHub 后可以评论和点赞。</p>
      </div>
    `;
  }

  return `
    <div class="github-user">
      <img src="${session.user.avatarUrl}" alt="${session.user.login}" class="github-user__avatar" />
      <div>
        <strong>${session.user.name}</strong>
        <p>@${session.user.login}</p>
      </div>
    </div>
  `;
}

function loginHintMarkup(device) {
  if (!device) {
    return "";
  }

  return `
    <div class="notice">
      请在新打开的 GitHub 页面完成授权，并输入验证码 <code>${device.user_code}</code>。
      如果没有弹出新页面，可以直接打开 <code>${device.verification_uri}</code>。
    </div>
  `;
}

function tokenFallbackMarkup(kind) {
  return `
    <details class="auth-fallback">
      <summary>设备码登录异常？改用 GitHub Token</summary>
      <p>
        可使用 GitHub Personal Access Token 直接登录。
        ${kind === "guestbook" ? "留言和点赞至少需要仓库 issue 写权限。" : "评论和点赞至少需要仓库 issue 写权限。"}
      </p>
      <label class="composer-label" for="token-login-${kind}">
        GitHub access token
      </label>
      <input
        id="token-login-${kind}"
        class="token-input"
        type="password"
        placeholder="ghp_... / github_pat_..."
        autocomplete="off"
      />
      <div class="button-row">
        <button class="button button-secondary token-login" type="button">使用 Token 登录</button>
      </div>
    </details>
  `;
}

class GitHubThreadWidget {
  constructor(container) {
    this.container = container;
    this.config = {
      owner: container.dataset.owner,
      repo: container.dataset.repo,
      clientId: container.dataset.clientId,
      scope: container.dataset.scope,
      authBaseUrl: container.dataset.authBaseUrl,
      issueNumber: Number(container.dataset.issueNumber),
      threadKey: container.dataset.threadKey,
      kind: container.dataset.kind
    };
    this.issue = null;
    this.comments = [];
    this.session = null;
    this.pendingDevice = null;
    this.loadError = "";
    this.notice = "";
    this.noticeType = "info";
  }

  async init() {
    this.session = await getActiveSession();
    await this.reload();
  }

  setNotice(message, type = "info") {
    this.notice = message || "";
    this.noticeType = type;
  }

  clearNotice() {
    this.notice = "";
    this.noticeType = "info";
  }

  async reload() {
    try {
      this.loadError = "";
      const issueUrl = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.issueNumber}`;
      const commentsUrl = `${issueUrl}/comments?per_page=100`;
      this.issue = await githubJson(issueUrl, {
        accept: "application/vnd.github.full+json"
      });
      this.comments = await githubJson(commentsUrl, {
        accept: "application/vnd.github.full+json"
      });
      this.render();
    } catch (error) {
      this.loadError = error.message || String(error);
      this.render();
    }
  }

  render() {
    if (this.loadError) {
      this.container.innerHTML = `
        <div class="github-thread__header">
          <span class="chip">GitHub Issues</span>
          <h3>${this.config.kind === "guestbook" ? "留言板" : "评论与点赞"}</h3>
        </div>
        <div class="notice">互动区加载失败：${this.loadError}</div>
      `;
      return;
    }

    const issueLikes = this.issue?.reactions?.["+1"] || 0;
    const noticeMarkup = this.notice
      ? `<div class="notice${this.noticeType === "danger" ? " notice--danger" : ""}">${this.notice}</div>`
      : "";
    const commentsMarkup =
      this.comments.length > 0
        ? this.comments
            .map(
              (comment) => `
                <article class="comment-card">
                  <div class="comment-card__meta">
                    <div class="github-user">
                      <img src="${comment.user.avatar_url}" alt="${comment.user.login}" class="github-user__avatar" />
                      <div>
                        <strong>${comment.user.login}</strong>
                        <p>${formatDate(comment.created_at)}</p>
                      </div>
                    </div>
                    <button class="button button-secondary comment-react" data-comment-id="${comment.id}">
                      👍 ${comment.reactions?.["+1"] || 0}
                    </button>
                  </div>
                  <div class="comment-body prose">${comment.body_html || comment.body}</div>
                </article>
              `
            )
            .join("")
        : `<div class="notice">还没有评论。欢迎成为第一个留言的人。</div>`;

    this.container.innerHTML = `
      <div class="github-thread__header">
        <div>
          <span class="chip">GitHub Issues</span>
          <h3>${this.config.kind === "guestbook" ? "留言板" : "评论与点赞"}</h3>
          <p>${this.config.kind === "guestbook" ? "每条留言都会写入 GitHub issue 评论。" : "每篇文章的评论线程都保存在仓库 issue 中。"} </p>
        </div>
        <div class="button-row">
          <button class="button button-secondary thread-react">👍 ${issueLikes}</button>
          <a class="button button-ghost" href="${this.issue.html_url}" target="_blank" rel="noreferrer">查看 GitHub 线程</a>
        </div>
      </div>

      ${noticeMarkup}
      <div class="github-auth-panel">
        ${renderUserBadge(this.session)}
        <div class="button-row">
          ${
            this.session
              ? `<button class="button button-secondary thread-logout">退出登录</button>`
              : `<button class="button button-primary thread-login">使用 GitHub 登录后评论</button>`
          }
        </div>
      </div>

      ${loginHintMarkup(this.pendingDevice)}
      ${this.session ? "" : tokenFallbackMarkup(this.config.kind)}

      <div class="github-thread__composer">
        <label class="composer-label" for="thread-comment-${this.config.issueNumber}">
          ${this.config.kind === "guestbook" ? "写一条留言" : "写一条评论"}
        </label>
        <textarea id="thread-comment-${this.config.issueNumber}" class="composer-input" rows="6" placeholder="支持 Markdown。"></textarea>
        <div class="button-row">
          <button class="button button-primary thread-submit">发布</button>
          <button class="button button-secondary thread-refresh">刷新</button>
        </div>
      </div>

      <div class="github-thread__list">${commentsMarkup}</div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    this.container.querySelector(".thread-login")?.addEventListener("click", async () => {
      await this.login();
    });

    this.container.querySelector(".thread-logout")?.addEventListener("click", async () => {
      clearStoredSession();
      this.session = null;
      this.pendingDevice = null;
      this.render();
    });

    this.container.querySelector(".token-login")?.addEventListener("click", async () => {
      await this.loginWithToken();
    });

    this.container.querySelector(".thread-refresh")?.addEventListener("click", async () => {
      this.session = await getActiveSession();
      await this.reload();
    });

    this.container.querySelector(".thread-submit")?.addEventListener("click", async () => {
      await this.submitComment();
    });

    this.container.querySelector(".thread-react")?.addEventListener("click", async () => {
      await this.reactToIssue();
    });

    this.container.querySelectorAll(".comment-react").forEach((button) => {
      button.addEventListener("click", async () => {
        const commentId = Number(button.dataset.commentId);
        await this.reactToComment(commentId);
      });
    });
  }

  async login() {
    this.pendingDevice = null;
    this.clearNotice();
    this.render();

    try {
      this.session = await startDeviceFlowLogin(this.config, {
        onCode: (device) => {
          this.pendingDevice = device;
          this.render();
        }
      });
      this.pendingDevice = null;
      this.clearNotice();
      this.render();
    } catch (error) {
      this.pendingDevice = null;
      this.setNotice(error.message || String(error), "danger");
      this.render();
    }
  }

  async ensureLogin() {
    this.session = await getActiveSession();
    if (!this.session) {
      await this.login();
    }

    if (!this.session) {
      throw new Error("需要先登录 GitHub 才能执行此操作。");
    }
  }

  async loginWithToken() {
    try {
      const input = this.container.querySelector(".token-input");
      this.clearNotice();
      this.pendingDevice = null;
      this.session = await createSessionFromAccessToken(
        input?.value || "",
        this.config.scope
      );
      if (input) {
        input.value = "";
      }
      await this.reload();
    } catch (error) {
      this.setNotice(error.message || String(error), "danger");
      this.render();
    }
  }

  async submitComment() {
    try {
      await this.ensureLogin();
      const textarea = this.container.querySelector(".composer-input");
      const body = textarea.value.trim();
      if (!body) {
        throw new Error("请输入评论内容。");
      }

      await githubJson(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.issueNumber}/comments`,
        {
          method: "POST",
          token: this.session.accessToken,
          accept: "application/vnd.github+json",
          body: { body }
        }
      );

      textarea.value = "";
      this.setNotice(
        this.config.kind === "guestbook" ? "留言已发布。" : "评论已发布。",
        "info"
      );
      await this.reload();
    } catch (error) {
      this.setNotice(error.message || String(error), "danger");
      this.render();
    }
  }

  async reactToIssue() {
    try {
      await this.ensureLogin();
      await githubJson(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.issueNumber}/reactions`,
        {
          method: "POST",
          token: this.session.accessToken,
          accept: "application/vnd.github+json",
          body: { content: "+1" }
        }
      );
      this.setNotice("点赞已提交。", "info");
      await this.reload();
    } catch (error) {
      this.setNotice(error.message || String(error), "danger");
      this.render();
    }
  }

  async reactToComment(commentId) {
    try {
      await this.ensureLogin();
      await githubJson(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/comments/${commentId}/reactions`,
        {
          method: "POST",
          token: this.session.accessToken,
          accept: "application/vnd.github+json",
          body: { content: "+1" }
        }
      );
      this.setNotice("评论点赞已提交。", "info");
      await this.reload();
    } catch (error) {
      this.setNotice(error.message || String(error), "danger");
      this.render();
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-github-thread]").forEach((node) => {
    const widget = new GitHubThreadWidget(node);
    widget.init();
  });
});
