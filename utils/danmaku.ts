export interface DanmakuAnime {
  animeId: number;
  bangumiId?: string;
  animeTitle: string;
  type: string;
  typeDescription: string;
  imageUrl?: string;
  startDate?: string;
  episodeCount?: number;
  commentCount?: number;
  source: string;
}

export interface DanmakuEpisode {
  episodeId: number;
  episodeTitle: string;
}

export interface DanmakuComment {
  p: string;
  m: string;
  cid: number;
}

export interface DanmakuSelection {
  animeId: number;
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  searchKeyword?: string;
}

export interface DisplayDanmaku {
  text: string;
  time: number;
  color: string;
  mode: number; // 0 scroll, 1 top, 2 bottom
}

export interface DanmakuSearchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  animes: DanmakuAnime[];
}

export interface DanmakuEpisodesResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  bangumi: {
    bangumiId: string;
    animeTitle: string;
    episodes: DanmakuEpisode[];
  };
}

export interface DanmakuCommentsResponse {
  count: number;
  comments: DanmakuComment[];
}

/** 反转义 XML 基本实体，避免弹幕文本显示 &amp; 等字面量 */
function unescapeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * 解析 bilibili 风格的弹幕 XML（上游 /api/v2/comment/* 默认返回格式）。
 * 参考实现：MoonTV src_app_api_danmaku_comment_route.ts 的 parseXmlDanmaku。
 */
export function parseDanmakuXmlComments(xmlText: string): DanmakuComment[] {
  const comments: DanmakuComment[] = [];
  const dTagRegex = /<d\s+(?:[^>]*?\s)?p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  let match: RegExpExecArray | null;
  while ((match = dTagRegex.exec(xmlText)) !== null) {
    const p = match[1];
    const m = unescapeXmlEntities(match[2]);
    const pParts = p.split(",");
    const cid = pParts[7] ? parseInt(pParts[7], 10) : 0;
    comments.push({ p, m, cid });
  }
  return comments;
}

/**
 * 归一化弹幕评论响应：优先按 JSON 解析（代理模式、部分支持 json 的上游），
 * 失败时按 bilibili 风格弹幕 XML 解析（dandanplay 兼容上游的默认格式）。
 */
export function parseDanmakuCommentsPayload(payload: string): DanmakuCommentsResponse {
  try {
    const json = JSON.parse(payload);
    const comments = Array.isArray(json?.comments) ? json.comments : [];
    return {
      count: typeof json?.count === "number" ? json.count : comments.length,
      comments,
    };
  } catch {
    // 非响应体 JSON，尝试弹幕 XML
  }
  const comments = parseDanmakuXmlComments(payload);
  return { count: comments.length, comments };
}

export function convertDanmakuFormat(comments: DanmakuComment[]): DisplayDanmaku[] {
  return comments
    .map((comment) => {
      const parts = (comment.p || "").split(",");
      const time = parseFloat(parts[0]) || 0;
      const type = parseInt(parts[1], 10) || 1;
      const colorValue = parseInt(parts[3], 10);
      const color =
        Number.isFinite(colorValue) && colorValue > 0
          ? `#${colorValue.toString(16).padStart(6, "0")}`
          : "#ffffff";

      let mode = 0;
      if (type === 5) mode = 1;
      else if (type === 4) mode = 2;

      return {
        text: (comment.m || "").trim(),
        time,
        color,
        mode,
      };
    })
    .filter((item) => item.text.length > 0)
    .sort((a, b) => a.time - b.time);
}

export function normalizeDanmakuTitle(title: string): string {
  return title
    .replace(/\s+/g, "")
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

export function filterDanmakuSources(
  animes: DanmakuAnime[],
  videoTitle: string,
  videoYear?: string
): DanmakuAnime[] {
  if (animes.length <= 1) return animes;

  const extractYear = (dateStr?: string): string | null => {
    if (!dateStr) return null;
    const match = dateStr.match(/^(\d{4})/);
    return match ? match[1] : null;
  };

  const normalizedVideoTitle = normalizeDanmakuTitle(videoTitle);

  if (videoYear) {
    const exactMatches = animes.filter((anime) => {
      const animeYear = extractYear(anime.startDate);
      return animeYear === videoYear && normalizeDanmakuTitle(anime.animeTitle) === normalizedVideoTitle;
    });
    if (exactMatches.length > 0) return exactMatches;
  }

  const titleMatches = animes.filter(
    (anime) => normalizeDanmakuTitle(anime.animeTitle) === normalizedVideoTitle
  );
  if (titleMatches.length > 0) return titleMatches;

  if (videoYear) {
    const yearMatches = animes.filter((anime) => extractYear(anime.startDate) === videoYear);
    if (yearMatches.length > 0) return yearMatches;
  }

  return animes;
}

export function formatDanmakuSourceLabel(
  anime: Pick<DanmakuAnime, "animeTitle" | "source" | "episodeCount" | "commentCount">
): string {
  const parts = [anime.animeTitle];
  if (anime.source) parts.push(anime.source);
  if (anime.episodeCount) parts.push(`${anime.episodeCount}集`);
  const base = parts.filter(Boolean).join(" · ");
  return typeof anime.commentCount === "number" ? `${base}（${anime.commentCount}条）` : base;
}

export function extractEpisodeNumber(title: string): number | null {
  if (!title) return null;
  const embyMatch = title.match(/[Ss]\d+[Ee](\d+)/);
  if (embyMatch) return parseInt(embyMatch[1], 10);
  const match = title.match(/^(\d+)$|第?\s*(\d+)\s*[集话話]?/);
  return match ? parseInt(match[1] || match[2], 10) : null;
}

export function matchDanmakuEpisode(
  currentEpisodeIndex: number,
  danmakuEpisodes: DanmakuEpisode[],
  videoEpisodeTitle?: string
): DanmakuEpisode | null {
  if (!danmakuEpisodes.length) return null;

  if (videoEpisodeTitle) {
    const episodeNum = extractEpisodeNumber(videoEpisodeTitle);
    if (episodeNum !== null) {
      for (const ep of danmakuEpisodes) {
        if (extractEpisodeNumber(ep.episodeTitle) === episodeNum) {
          return ep;
        }
      }
    }
  }

  // 索引超出范围时返回 null，避免错配弹幕
  if (currentEpisodeIndex < 0 || currentEpisodeIndex >= danmakuEpisodes.length) {
    return null;
  }
  return danmakuEpisodes[currentEpisodeIndex];
}

export const DANMAKU_SCROLL_DURATION = 8;
export const DANMAKU_FIXED_DURATION = 4.2;
export const DANMAKU_MAX_FLYING = 48;
export const DANMAKU_TRACKS = 10;
export const DANMAKU_LATE_WINDOW = 1.2;
export const DANMAKU_SPAWN_LOOKBACK = 0.2;
export const DANMAKU_TRACK_GAP = 1.1;

export const DANMAKU_AREA_OPTIONS = [0.25, 0.5, 0.75] as const;
export type DanmakuArea = (typeof DANMAKU_AREA_OPTIONS)[number];

export const DANMAKU_DENSITY_OPTIONS = ["sparse", "medium", "unlimited"] as const;
export type DanmakuDensity = (typeof DANMAKU_DENSITY_OPTIONS)[number];

export const DANMAKU_DEFAULT_AREA: DanmakuArea = 0.25;
export const DANMAKU_DEFAULT_DENSITY: DanmakuDensity = "medium";

const DENSITY_MAX_PER_WINDOW: Record<DanmakuDensity, number> = {
  sparse: 4,
  medium: 10,
  unlimited: Number.POSITIVE_INFINITY,
};
const DENSITY_MAX_SAME_TEXT: Record<DanmakuDensity, number> = {
  sparse: 1,
  medium: 2,
  unlimited: Number.POSITIVE_INFINITY,
};
const DENSITY_MAX_FLYING: Record<DanmakuDensity, number> = {
  sparse: 16,
  medium: 32,
  unlimited: 64,
};

export function isDanmakuArea(value: unknown): value is DanmakuArea {
  return DANMAKU_AREA_OPTIONS.includes(value as DanmakuArea);
}

export function isDanmakuDensity(value: unknown): value is DanmakuDensity {
  return DANMAKU_DENSITY_OPTIONS.includes(value as DanmakuDensity);
}

export function danmakuMaxFlying(density: DanmakuDensity): number {
  return DENSITY_MAX_FLYING[density];
}

export function danmakuTrackCount(screenHeight: number, fontSize: number, areaRatio: number): number {
  const line = fontSize + 8;
  const usable = Math.max(line, screenHeight * areaRatio - 16);
  return Math.max(3, Math.min(24, Math.floor(usable / line)));
}

export function filterDanmakuByDensity(
  comments: DisplayDanmaku[],
  density: DanmakuDensity
): DisplayDanmaku[] {
  if (density === "unlimited") return comments;

  const maxPerWindow = DENSITY_MAX_PER_WINDOW[density];
  const maxSameText = DENSITY_MAX_SAME_TEXT[density];
  const result: DisplayDanmaku[] = [];
  let index = 0;

  while (index < comments.length) {
    const windowStart = Math.floor(comments[index].time);
    const windowItems: DisplayDanmaku[] = [];
    while (index < comments.length && Math.floor(comments[index].time) === windowStart) {
      windowItems.push(comments[index]);
      index += 1;
    }

    const textCount = new Map<string, number>();
    const deduped: DisplayDanmaku[] = [];
    for (const item of windowItems) {
      const seen = textCount.get(item.text) ?? 0;
      if (seen >= maxSameText) continue;
      textCount.set(item.text, seen + 1);
      deduped.push(item);
    }

    if (deduped.length <= maxPerWindow) {
      result.push(...deduped);
      continue;
    }

    const ranked = [...deduped].sort((a, b) => scoreDanmaku(b) - scoreDanmaku(a) || a.time - b.time);
    ranked
      .slice(0, maxPerWindow)
      .sort((a, b) => a.time - b.time)
      .forEach((item) => result.push(item));
  }

  return result;
}

function scoreDanmaku(item: DisplayDanmaku): number {
  const colorBonus = item.color.toLowerCase() !== "#ffffff" ? 3 : 0;
  const lengthBonus = Math.min(item.text.length, 24) * 0.15;
  const modeBonus = item.mode !== 0 ? 2 : 0;
  return colorBonus + lengthBonus + modeBonus;
}

export type VideoClockSnapshot = {
  time: number;
  wall: number;
  playing: boolean;
  rate: number;
};

export type VideoClockSyncState = {
  videoTime: number;
  playing: boolean;
  rate: number;
};

export function interpolateVideoTime(clock: VideoClockSnapshot, now: number): number {
  if (!clock.playing) return clock.time;
  return clock.time + ((now - clock.wall) / 1000) * (clock.rate || 1);
}

export function shouldRefreshVideoClock(
  prev: VideoClockSyncState,
  next: VideoClockSyncState
): boolean {
  return prev.videoTime !== next.videoTime || prev.playing !== next.playing || prev.rate !== next.rate;
}

export const VIDEO_CLOCK_SNAP_SEC = 0.75;

export function danmakuScrollProgress(commentTime: number, videoTime: number, duration: number): number {
  if (!(duration > 0)) return 1;
  const elapsed = videoTime - commentTime;
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 1;
  return elapsed / duration;
}

export function isDanmakuActive(commentTime: number, videoTime: number, duration: number): boolean {
  if (!(duration > 0)) return false;
  const elapsed = videoTime - commentTime;
  // 1ms 容差，避免 10.2 - 6 这种浮点误差让到期弹幕多停一帧
  return elapsed >= -0.001 && elapsed < duration - 0.001;
}

export function fixedDanmakuOpacity(
  commentTime: number,
  videoTime: number,
  duration: number,
  opacity: number
): number {
  if (!isDanmakuActive(commentTime, videoTime, duration)) return 0;
  const elapsed = videoTime - commentTime;
  const fade = Math.min(0.4, duration / 4);
  if (fade <= 0) return opacity;
  if (elapsed < fade) return opacity * (elapsed / fade);
  const tail = duration - elapsed;
  if (tail < fade) return opacity * (tail / fade);
  return opacity;
}

export type ActiveDanmaku = DisplayDanmaku & { index: number };

function lowerBoundTime(comments: Array<{ time: number }>, time: number): number {
  let lo = 0;
  let hi = comments.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (comments[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function collectActiveDanmaku(
  comments: DisplayDanmaku[],
  videoTime: number,
  limit: number
): ActiveDanmaku[] {
  if (limit <= 0 || comments.length === 0) return [];
  const windowStart = videoTime - DANMAKU_SCROLL_DURATION;
  let index = lowerBoundTime(comments, windowStart);
  const active: ActiveDanmaku[] = [];
  for (; index < comments.length; index += 1) {
    const item = comments[index];
    if (item.time > videoTime) break;
    if (!isDanmakuActive(item.time, videoTime, danmakuDuration(item.mode))) continue;
    active.push({ ...item, index });
  }
  if (active.length <= limit) return active;
  return active.slice(active.length - limit);
}

export function reconcileVideoClock(
  clock: VideoClockSnapshot,
  sample: VideoClockSyncState,
  now: number,
  snapSec = VIDEO_CLOCK_SNAP_SEC
): VideoClockSnapshot {
  const rate = sample.rate || 1;
  if (!sample.playing) {
    return { time: sample.videoTime, wall: now, playing: false, rate };
  }
  const predicted = interpolateVideoTime(clock, now);
  const drift = sample.videoTime - predicted;
  if (!clock.playing || clock.rate !== rate || Math.abs(drift) >= snapSec) {
    return { time: sample.videoTime, wall: now, playing: true, rate };
  }
  return { time: predicted + drift * 0.5, wall: now, playing: true, rate };
}

export function scrollTranslateX(screenWidth: number, itemWidth: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return screenWidth - p * (screenWidth + itemWidth);
}

export function progressFromTranslateX(x: number, screenWidth: number, itemWidth: number): number {
  const total = screenWidth + itemWidth;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (screenWidth - x) / total));
}

export function remainingScrollMs(totalSeconds: number, elapsedSeconds: number): number {
  return Math.max(0, (totalSeconds - Math.max(0, elapsedSeconds)) * 1000);
}

export function findSpawnIndex(
  comments: Array<{ time: number }>,
  time: number,
  lookback = DANMAKU_SPAWN_LOOKBACK
): number {
  let idx = 0;
  while (idx < comments.length && comments[idx].time < time - lookback) idx += 1;
  return idx;
}

export function shouldSpawnComment(
  commentTime: number,
  now: number,
  lateWindow = DANMAKU_LATE_WINDOW
): boolean {
  return commentTime >= now - lateWindow;
}

export function danmakuDuration(mode: number): number {
  return mode === 0 ? DANMAKU_SCROLL_DURATION : DANMAKU_FIXED_DURATION;
}

export function estimateDanmakuWidth(text: string, fontSize: number): number {
  return Math.max(24, text.length * fontSize * 0.95);
}

export function pickDanmakuTrack(
  now: number,
  mode: number,
  tracks: number[],
  minGap = DANMAKU_TRACK_GAP,
  allowOverlap = true
): number {
  if (mode !== 0) return mode === 1 ? 0 : tracks.length - 1;
  let best = 0;
  let bestTime = Number.POSITIVE_INFINITY;
  for (let i = 0; i < tracks.length; i++) {
    const lastTime = tracks[i] ?? -999;
    if (now - lastTime > minGap) {
      tracks[i] = now;
      return i;
    }
    if (lastTime < bestTime) {
      bestTime = lastTime;
      best = i;
    }
  }
  if (!allowOverlap) return -1;
  tracks[best] = now;
  return best;
}

export function danmakuTrackToY(
  track: number,
  mode: number,
  screenHeight: number,
  fontSize: number,
  tracks = DANMAKU_TRACKS,
  areaRatio = DANMAKU_DEFAULT_AREA
): number {
  const paddingTop = 10;
  const line = fontSize + 6;
  const usable = screenHeight * areaRatio;
  if (mode === 2) return paddingTop + Math.max(0, usable - line - 8);
  if (tracks <= 1) return paddingTop;
  const spacing = Math.max(line, (usable - line) / (tracks - 1));
  return paddingTop + Math.min(track, tracks - 1) * spacing;
}
