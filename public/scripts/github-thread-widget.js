import {
  clearStoredSession,
  getActiveSession,
  githubJson,
  startWebFlowLogin
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

function loginHintMarkup(isPending) {
  if (!isPending) {
    return "";
  }

  return `
    <div class="notice">
      GitHub 授权窗口已经打开，请在弹窗中确认登录并授权当前站点。
    </div>
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
    this.pendingAuth = false;
    this.error = "";
  }

  async init() {
    this.session = await getActiveSession();
    await this.reload();
  }

  async reload() {
    try {
      this.error = "";
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
      this.error = error.message || String(error);
      this.render();
    }
  }

  render() {
    if (this.error) {
      this.container.innerHTML = `
        <div class="github-thread__header">
          <span class="chip">GitHub Issues</span>
          <h3>${this.config.kind === "guestbook" ? "留言板" : "评论与点赞"}</h3>
        </div>
        <div class="notice">互动区加载失败：${this.error}</div>
      `;
      return;
    }

    const issueLikes = this.issue?.reactions?.["+1"] || 0;
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

      ${loginHintMarkup(this.pendingAuth)}

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
      this.pendingAuth = false;
      this.render();
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
    this.pendingAuth = false;
    this.error = "";
    this.render();

    try {
      this.session = await startWebFlowLogin(this.config, {
        onOpen: () => {
          this.pendingAuth = true;
          this.render();
        }
      });
      this.pendingAuth = false;
      this.error = "";
      this.render();
    } catch (error) {
      this.pendingAuth = false;
      this.error = error.message || String(error);
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
      await this.reload();
    } catch (error) {
      this.error = error.message || String(error);
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
      await this.reload();
    } catch (error) {
      this.error = error.message || String(error);
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
      await this.reload();
    } catch (error) {
      this.error = error.message || String(error);
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
