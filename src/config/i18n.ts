import { withBase } from "../utils/with-base";

export type Locale = "zh" | "en";

export const defaultLocale: Locale = "zh";
export const locales: Locale[] = ["zh", "en"];

export const localeLabels: Record<Locale, string> = {
  zh: "中文",
  en: "English"
};

export const siteText = {
  zh: {
    locale: "zh-CN",
    siteName: "Maobaolong Engineering",
    tagline: "系统、性能、AI Infra 与工程实践",
    description: "毛宝龙的技术博客，聚焦 AI 基础设施、分布式系统、数据库与高质量工程写作。",
    admin: "后台管理",
    github: "GitHub",
    navLabel: "主导航",
    footerGuestbook: "留言板",
    footerAdmin: "后台"
  },
  en: {
    locale: "en",
    siteName: "Maobaolong Engineering",
    tagline: "Systems, Performance, AI Infra, and Engineering Practice",
    description: "Maobaolong's engineering blog on AI infrastructure, distributed systems, databases, and high-quality technical writing.",
    admin: "Admin",
    github: "GitHub",
    navLabel: "Primary navigation",
    footerGuestbook: "Guestbook",
    footerAdmin: "Admin"
  }
} as const;

export const navigationText = {
  zh: [
    { label: "首页", href: "/" },
    { label: "博客", href: "/blog/" },
    { label: "留言板", href: "/message-board/" },
    { label: "关于", href: "/about/" }
  ],
  en: [
    { label: "Home", href: "/en/" },
    { label: "Blog", href: "/en/blog/" },
    { label: "Guestbook", href: "/en/message-board/" },
    { label: "About", href: "/en/about/" }
  ]
} as const;

export function localizedPath(pathname: string, locale: Locale) {
  const cleanPath = pathname || "/";
  const withoutBase = cleanPath.replace(import.meta.env.BASE_URL, "/");
  const withoutEn = withoutBase.startsWith("/en/") ? withoutBase.slice(3) : withoutBase === "/en" ? "/" : withoutBase;
  const target = locale === "en" ? `/en${withoutEn === "/" ? "/" : withoutEn}` : withoutEn;
  return withBase(target);
}

export function isCurrentPath(currentPath: string, href: string) {
  const homePaths = new Set([withBase("/"), withBase("/en/")]);
  return currentPath === href || (!homePaths.has(href) && currentPath.startsWith(href));
}
