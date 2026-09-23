import {
  clearStoredSession,
  createSessionFromAccessToken,
  getActiveSession,
  githubJson,
  startDeviceFlowLogin
} from "./github-auth.js";

const copy = {
  zh: {
    dateLocale: "zh-CN",
    guest: "Guest",
    guestHint: "登录 GitHub 后可以评论和点赞。",
    loginHint: (device) => `请在新打开的 GitHub 页面完成授权，并输入验证码 <code>${device.user_code}</code>。如果没有弹出新页面，可以直接打开 <code>${device.verification_uri}</code>。`,
    tokenSummary: "设备码登录异常？改用 GitHub Token",
    tokenCopy: (kind) => `可使用 GitHub Personal Access Token 直接登录。${kind === "guestbook" ? "留言和点赞至少需要仓库 issue 写权限。" : "评论和点赞至少需要仓库 issue 写权限。"}`,
    tokenLogin: "使用 Token 登录",
    title: (kind) => kind === "guestbook" ? "留言板" : "评论与点赞",
    loadFailed: "互动区加载失败",
    empty: "还没有评论。欢迎成为第一个留言的人。",
    intro: (kind) => kind === "guestbook" ? "每条留言都会写入 GitHub issue 评论。" : "每篇文章的评论线程都保存在仓库 issue 中。",
    viewThread: "查看 GitHub 线程",
    logout: "退出登录",
    login: "使用 GitHub 登录后评论",
    composerLabel: (kind) => kind === "guestbook" ? "写一条留言" : "写一条评论",
    placeholder: "支持 Markdown。",
    submit: "发布",
    refresh: "刷新",
    requireLogin: "需要先登录 GitHub 才能执行此操作。",
    emptyComment: "请输入评论内容。",
    posted: (kind) => kind === "guestbook" ? "留言已发布。" : "评论已发布。",
    reacted: "点赞已提交。",
    commentReacted: "评论点赞已提交。"
  },
  en: {
    dateLocale: "en-US",
    guest: "Guest",
    guestHint: "Sign in with GitHub to comment and react.",
    loginHint: (device) => `Complete authorization on the GitHub page that just opened, then enter code <code>${device.user_code}</code>. If no page opened, visit <code>${device.verification_uri}</code> directly.`,
    tokenSummary: "Device login not working? Use a GitHub token",
    tokenCopy: (kind) => `You can sign in directly with a GitHub Personal Access Token. ${kind === "guestbook" ? "Guestbook posts and reactions require issue write access on the repository." : "Comments and reactions require issue write access on the repository."}`,
    tokenLogin: "Use token",
    title: (kind) => kind === "guestbook" ? "Guestbook" : "Comments and Reactions",
    loadFailed: "Discussion failed to load",
    empty: "No comments yet. Be the first to leave one.",
    intro: (kind) => kind === "guestbook" ? "Each message is stored as a GitHub issue comment." : "Each article discussion thread is stored in a repository issue.",
    viewThread: "View GitHub thread",
    logout: "Sign out",
    login: "Sign in with GitHub to comment",
    composerLabel: (kind) => kind === "guestbook" ? "Write a message" : "Write a comment",
    placeholder: "Markdown is supported.",
    submit: "Post",
    refresh: "Refresh",
    requireLogin: "You need to sign in with GitHub before doing this.",
    emptyComment: "Please enter a comment.",
    posted: (kind) => kind === "guestbook" ? "Message posted." : "Comment posted.",
    reacted: "Reaction submitted.",
    commentReacted: "Comment reaction submitted."
  }
};

function messages(locale) {
  return copy[locale] || copy.zh;
}

function formatDate(iso, locale) {
  return new Date(iso).toLocaleString(messages(locale).dateLocale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderUserBadge(session, text) {
  if (!session?.user) {
    return `
      <div class="github-user">
        <span class="chip">${text.guest}</span>
        <p>${text.guestHint}</p>
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

function loginHintMarkup(device, text) {
  if (!device) {
    return "";
  }

  return `
    <div class="notice">
      ${text.loginHint(device)}
    </div>
  `;
}

function tokenFallbackMarkup(kind, text) {
  return `
    <details class="auth-fallback">
      <summary>${text.tokenSummary}</summary>
      <p>
        ${text.tokenCopy(kind)}
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
        <button class="button button-secondary token-login" type="button">${text.tokenLogin}</button>
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
      kind: container.dataset.kind,
      locale: container.dataset.locale || "zh"
    };
    this.text = messages(this.config.locale);
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
    await this.reload({ bustCache: true });
  }

  setNotice(message, type = "info") {
    this.notice = message || "";
    this.noticeType = type;
  }

  clearNotice() {
    this.notice = "";
    this.noticeType = "info";
  }

  async reload(options = {}) {
    try {
      this.loadError = "";
      const issueUrl = new URL(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.issueNumber}`
      );
      const commentsUrl = new URL(`${issueUrl.toString()}/comments`);
      commentsUrl.searchParams.set("per_page", "100");

      if (options.bustCache) {
        const cacheBust = Date.now().toString();
        issueUrl.searchParams.set("_", cacheBust);
        commentsUrl.searchParams.set("_", cacheBust);
      }

      this.issue = await githubJson(issueUrl.toString(), {
        accept: "application/vnd.github.full+json",
        cache: "no-store"
      });
      this.comments = await githubJson(commentsUrl.toString(), {
        accept: "application/vnd.github.full+json",
        cache: "no-store"
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
          <h3>${this.text.title(this.config.kind)}</h3>
        </div>
        <div class="notice">${this.text.loadFailed}：${this.loadError}</div>
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
                        <p>${formatDate(comment.created_at, this.config.locale)}</p>
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
        : `<div class="notice">${this.text.empty}</div>`;

    this.container.innerHTML = `
      <div class="github-thread__header">
        <div>
          <span class="chip">GitHub Issues</span>
          <h3>${this.text.title(this.config.kind)}</h3>
          <p>${this.text.intro(this.config.kind)} </p>
        </div>
        <div class="button-row">
          <button class="button button-secondary thread-react">👍 ${issueLikes}</button>
          <a class="button button-ghost" href="${this.issue.html_url}" target="_blank" rel="noreferrer">${this.text.viewThread}</a>
        </div>
      </div>

      ${noticeMarkup}
      <div class="github-auth-panel">
        ${renderUserBadge(this.session, this.text)}
        <div class="button-row">
          ${
            this.session
              ? `<button class="button button-secondary thread-logout">${this.text.logout}</button>`
              : `<button class="button button-primary thread-login">${this.text.login}</button>`
          }
        </div>
      </div>

      ${loginHintMarkup(this.pendingDevice, this.text)}
      ${this.session ? "" : tokenFallbackMarkup(this.config.kind, this.text)}

      <div class="github-thread__composer">
        <label class="composer-label" for="thread-comment-${this.config.issueNumber}">
          ${this.text.composerLabel(this.config.kind)}
        </label>
        <textarea id="thread-comment-${this.config.issueNumber}" class="composer-input" rows="6" placeholder="${this.text.placeholder}"></textarea>
        <div class="button-row">
          <button class="button button-primary thread-submit">${this.text.submit}</button>
          <button class="button button-secondary thread-refresh">${this.text.refresh}</button>
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
      await this.reload({ bustCache: true });
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
      throw new Error(this.text.requireLogin);
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
      await this.reload({ bustCache: true });
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
        throw new Error(this.text.emptyComment);
      }

      const createdComment = await githubJson(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${this.config.issueNumber}/comments`,
        {
          method: "POST",
          token: this.session.accessToken,
          accept: "application/vnd.github.full+json",
          body: { body }
        }
      );

      textarea.value = "";
      this.comments = [...this.comments, createdComment];
      this.setNotice(this.text.posted(this.config.kind), "info");
      this.render();
      window.setTimeout(() => {
        this.reload({ bustCache: true }).catch(() => {});
      }, 1500);
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
      this.setNotice(this.text.reacted, "info");
      await this.reload({ bustCache: true });
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
      this.setNotice(this.text.commentReacted, "info");
      await this.reload({ bustCache: true });
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
