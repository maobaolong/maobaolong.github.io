export function withBase(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = import.meta.env.BASE_URL || "/";

  if (base === "/") {
    return cleanPath;
  }

  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return cleanPath === "/" ? `${normalizedBase}/` : `${normalizedBase}${cleanPath}`;
}
