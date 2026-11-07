const BUILTIN_DANMAKU_API_BASE = "https://mtvpls-danmu.netlify.app/87654321";
const BUILTIN_DANMAKU_API_TOKEN = "87654321";

const DANMAKU_API_FIELDS = [
  "DanmakuApiBaseUrl",
  "DanmuApiBaseUrl",
  "DANMU_API_BASE_URL",
  "danmakuApi",
  "danmaku_api",
  "danmuApi",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickDanmakuApiField(record: Record<string, unknown> | null): string {
  if (!record) return "";
  for (const field of DANMAKU_API_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\/+$/, "");
    }
  }
  return "";
}

function composeDanmakuApiUrl(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const direct = pickDanmakuApiField(record);
  if (direct) return direct;

  if (record.DanmakuSourceType === "builtin") {
    return BUILTIN_DANMAKU_API_BASE;
  }

  const rawBase =
    (typeof record.DanmakuApiBase === "string" && record.DanmakuApiBase) ||
    (typeof record.DANMAKU_API_BASE === "string" && record.DANMAKU_API_BASE) ||
    "";
  const base = rawBase.trim().replace(/\/+$/, "");
  const token = (
    (typeof record.DanmakuApiToken === "string" && record.DanmakuApiToken) ||
    (typeof record.DANMAKU_API_TOKEN === "string" && record.DANMAKU_API_TOKEN) ||
    ""
  ).trim();
  if (!base) return "";
  if (token && token !== BUILTIN_DANMAKU_API_TOKEN) {
    return `${base}/${token}`;
  }
  return base;
}

export function extractDanmakuApiUrl(source: unknown): string {
  const record = asRecord(source);
  if (!record) return "";
  return composeDanmakuApiUrl(record) || composeDanmakuApiUrl(asRecord(record.SiteConfig));
}

function sliceJsonObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function extractDanmakuApiUrlFromHtml(html: string): string {
  const marker = "window.RUNTIME_CONFIG";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return "";
  const equalsIndex = html.indexOf("=", markerIndex);
  if (equalsIndex < 0) return "";
  const start = html.indexOf("{", equalsIndex);
  if (start < 0) return "";

  const json = sliceJsonObject(html, start);
  if (!json) return "";
  try {
    return extractDanmakuApiUrl(JSON.parse(json));
  } catch {
    return "";
  }
}

/** 规范化用户输入的 API 基础地址：去首尾空格、去尾部斜杠、按主机名补协议。 */
export function normalizeBaseUrl(url: string): string {
  let processed = url.trim();
  if (!processed) return "";
  processed = processed.replace(/\/+$/, "");

  if (!/^https?:\/\//i.test(processed)) {
    const hostPart = processed.split("/")[0];
    const isIpAddress = /^((\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(hostPart);
    const hasPort = /:\d+/.test(hostPart);
    processed = (isIpAddress || hasPort ? "http://" : "https://") + processed;
  }

  return processed;
}

/** 历史别名：主 API 地址与弹幕地址共用同一套规范化规则。 */
export const normalizeDanmakuApiUrl = normalizeBaseUrl;

export type DanmakuRequestKind = "search" | "episodes" | "comments" | "commentsByUrl";

export function buildDanmakuRequestPath(
  kind: DanmakuRequestKind,
  params: { keyword?: string; animeId?: number; episodeId?: number; videoUrl?: string },
  useDirectApi: boolean
): string {
  if (useDirectApi) {
    switch (kind) {
      case "search":
        return `/api/v2/search/anime?keyword=${encodeURIComponent(params.keyword || "")}`;
      case "episodes":
        return `/api/v2/bangumi/${params.animeId}`;
      case "comments":
        // 参考实现（MoonTV）对 /api/v2/comment/* 指定 format=xml：上游默认返回 bilibili 风格弹幕 XML
        return `/api/v2/comment/${params.episodeId}?format=xml`;
      case "commentsByUrl":
        return `/api/v2/comment?url=${encodeURIComponent(params.videoUrl || "")}&format=xml`;
    }
  }

  switch (kind) {
    case "search":
      return `/api/danmaku/search?keyword=${encodeURIComponent(params.keyword || "")}`;
    case "episodes":
      return `/api/danmaku/episodes?animeId=${params.animeId}`;
    case "comments":
      return `/api/danmaku/comment?episodeId=${params.episodeId}`;
    case "commentsByUrl":
      return `/api/danmaku/comment?url=${encodeURIComponent(params.videoUrl || "")}`;
  }
}

export async function resolveDanmakuApiFromServer(options: {
  getServerConfig: () => Promise<unknown>;
  getHomepageHtml: () => Promise<string>;
}): Promise<string> {
  try {
    const fromConfig = extractDanmakuApiUrl(await options.getServerConfig());
    if (fromConfig) return fromConfig;
  } catch {
    // 服务端可能不支持该字段或接口，继续尝试首页 RUNTIME_CONFIG
  }

  try {
    return extractDanmakuApiUrlFromHtml(await options.getHomepageHtml());
  } catch {
    return "";
  }
}
