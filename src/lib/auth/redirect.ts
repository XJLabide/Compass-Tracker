export function safeLocalPath(path: string | null | undefined, fallback = "/today") {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}
