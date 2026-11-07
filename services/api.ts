import AsyncStorage from "@react-native-async-storage/async-storage";
import EventSource from "react-native-sse";
import { LoginCredentialsManager } from "./storage";
import type {
  DanmakuCommentsResponse,
  DanmakuEpisodesResponse,
  DanmakuSearchResponse,
} from "@/utils/danmaku";
import { buildDanmakuRequestPath } from "@/utils/danmakuApi";
import { parseDanmakuCommentsPayload } from "@/utils/danmaku";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface LiveSourceItem {
  key: string;
  name: string;
  url: string;
  ua: string;
}

export interface LiveSourceResponse {
  success: boolean;
  data: Array<LiveSourceItem>;
}


export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  q?: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  source_count?: number;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  episode_index: number;
  progress: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  search_title: string | null;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
}

export class API {
  public baseURL: string = "";
  public danmakuBaseURL: string = "";

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  public setDanmakuBaseUrl(url: string) {
    this.danmakuBaseURL = url;
  }

  public usesDirectDanmakuApi(): boolean {
    return Boolean(this.danmakuBaseURL);
  }

  private async _authHeaders(extra: HeadersInit = {}): Promise<HeadersInit> {
    const cookies = await AsyncStorage.getItem("authCookies");
    const match = cookies?.match(/auth=([^;]+)/);
    if (!match) return extra;
    return {
      ...extra,
      Cookie: `auth=${match[1]}`,
    };
  }

  private _reloginPromise: Promise<boolean> | null = null;

  /**
   * 使用本地保存的登录凭据静默重登（会话过期时自动恢复登录态，无需手动重新登录）。
   * 并发请求共享同一次重登，避免重复调用登录接口。
   */
  private async _silentRelogin(): Promise<boolean> {
    if (!this._reloginPromise) {
      this._reloginPromise = (async () => {
        try {
          const credentials = await LoginCredentialsManager.get();
          if (credentials?.password) {
            const username = credentials.username.trim() || undefined;
            const result = await this.login(username, credentials.password);
            return Boolean(result?.ok);
          }
          // 未保存过账号密码时，尝试游客登录（localstorage 无密码服务器）
          const guestResult = await this.login();
          return Boolean(guestResult?.ok);
        } catch {
          return false;
        } finally {
          this._reloginPromise = null;
        }
      })();
    }
    return this._reloginPromise;
  }

  private async _fetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    let response = await fetch(`${this.baseURL}${url}`, {
      ...options,
      headers: await this._authHeaders(options.headers),
    });

    // 会话过期（401）时先尝试静默重登并重试一次原请求；
    // 登录/登出接口自身的 401 不属于会话过期，不做重试
    if (
      response.status === 401 &&
      url !== "/api/login" &&
      url !== "/api/logout"
    ) {
      const reloginSucceeded = await this._silentRelogin();
      if (reloginSucceeded) {
        response = await fetch(`${this.baseURL}${url}`, {
          ...options,
          headers: await this._authHeaders(options.headers),
        });
      }
    }

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  private async _fetchDanmaku(url: string, options: RequestInit = {}): Promise<Response> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);
    try {
      if (this.danmakuBaseURL) {
        const response = await fetch(`${this.danmakuBaseURL}${url}`, {
          ...options,
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
      }
      return await this._fetch(url, { ...options, signal: abortController.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchHomepageHtml(): Promise<string> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }
    const response = await fetch(this.baseURL, {
      headers: await this._authHeaders(),
    });
    return response.text();
  }

  async login(username?: string | undefined, password?: string): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // 存储cookie到AsyncStorage
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", cookies);
    }

    return response.json();
  }

  async logout(): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/logout", {
      method: "POST",
    });
    await AsyncStorage.setItem("authCookies", '');
    return response.json();
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  async getDoubanData(
    type: "movie_hot" | "movie_new" | 'movie_high' | 'movie_unpop' | 'movie_all' | 'tv_hot' | 'tv_all' | 'show_hot' | 'show_all',
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    let url = '';
    if (type === 'movie_hot') {
      url = `/api/douban/categories?kind=movie&category=${encodeURIComponent('热门')}&type=${encodeURIComponent(tag)}&limit=${pageSize}&start=${pageStart}`
    }
    else if(type === 'movie_new') {
      url = `/api/douban/categories?kind=movie&category=${encodeURIComponent('最新')}&type=${encodeURIComponent(tag)}&limit=${pageSize}&start=${pageStart}`
    }
    else if(type === 'movie_high') {
      url = `/api/douban/categories?kind=movie&category=${encodeURIComponent('豆瓣高分')}&type=${encodeURIComponent(tag)}&limit=${pageSize}&start=${pageStart}`
    }
    else if(type === 'movie_unpop') {
      url = `/api/douban/categories?kind=movie&category=${encodeURIComponent('冷门佳片')}&type=${encodeURIComponent(tag)}&limit=${pageSize}&start=${pageStart}`
    }
    else if(type === 'movie_all') {
      url = `/api/douban/recommends?kind=movie&category=${encodeURIComponent(tag==='全部'?'all':tag)}&&format=&region=all&year=all&platform=all&sort=T&label=all&limit=${pageSize}&start=${pageStart}`
    }
    else if(type === 'tv_hot') {
      const mapTvHot = {
        '全部': 'tv',
        '国产': 'tv_domestic',
        '欧美': 'tv_american',
        '日本': 'tv_japanese',
        '韩国': 'tv_korean',
        '动漫': 'tv_animation',
        '纪录片': 'tv_documentary'
      };
      url = `/api/douban/categories?kind=tv&category=tv&type=${encodeURIComponent(mapTvHot[tag])}&limit=${pageSize}&start=${pageStart}`;
    }
    else if(type === 'tv_all') {
      url = `/api/douban/recommends?kind=tv&category=${encodeURIComponent(tag==='全部'?'all':tag)}&format=电视剧&region=all&year=all&platform=all&sort=T&label=all&limit=${pageSize}&start=${pageStart}`;
    }
    else if(type === 'show_hot') {
      const mapShowHot = {
        '全部': 'show',
        '国内': 'show_domestic',
        '国外': 'show_foreign',
      };
      url = `/api/douban/categories?kind=tv&category=show&type=${encodeURIComponent(mapShowHot[tag])}&limit=${pageSize}&start=${pageStart}`;
    }
    else if(type === 'show_all') {
      url = `/api/douban/recommends?kind=tv&category=${encodeURIComponent(tag==='全部'?'all':tag)}&format=综艺&region=all&year=all&platform=all&sort=T&label=all&limit=${pageSize}&start=${pageStart}`;
    }
    const response = await this._fetch(url);
    return response.json();
  }

  async getLiveSource(): Promise<LiveSourceResponse> {
    const url = `/api/live/sources`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideos(query: string): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideosWs(query: string, signal?: AbortSignal) {
    const cookies = await AsyncStorage.getItem('authCookies');
    if(!cookies) {
      throw new Error("No auth cookie!");
    }
    const match = cookies.match(/auth=(.+?);/);
    if (!match) {
      throw new Error("Find auth cookie failed!");
    }
    const auth = match[1];
    const arrMessages = [];
    const es = new EventSource(`${this.baseURL}/api/search/ws?q=${encodeURIComponent(query)}`, {
      headers: {
        Cookie: `auth=${auth};`
      }
    });
    es.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      arrMessages.push(data);
      if(data.type === 'complete' || signal?.aborted) {
        es.close();
      }
    });
    return arrMessages;
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchDanmaku(keyword: string): Promise<DanmakuSearchResponse> {
    const url = buildDanmakuRequestPath("search", { keyword }, this.usesDirectDanmakuApi());
    const response = await this._fetchDanmaku(url);
    const json = await response.json();
    const animes = (Array.isArray(json.animes) ? json.animes : []).map((anime: any) => ({
      ...anime,
      source: anime.source || anime.typeDescription || "",
      episodeCount: anime.episodeCount ?? anime.episodes?.length,
    }));
    // 与 getDanmakuEpisodes 保持一致的成功字段归一化，兼容缺失 success 字段的上游响应
    return {
      errorCode: json.errorCode ?? 0,
      success: json.success ?? (json.errorCode === 0 || animes.length > 0),
      errorMessage: json.errorMessage ?? "",
      animes,
    };
  }

  async getDanmakuEpisodes(animeId: number): Promise<DanmakuEpisodesResponse> {
    const url = buildDanmakuRequestPath("episodes", { animeId }, this.usesDirectDanmakuApi());
    const response = await this._fetchDanmaku(url);
    const json = await response.json();
    const episodes = json.bangumi?.episodes || json.episodes || [];
    return {
      errorCode: json.errorCode ?? 0,
      success: json.success ?? (json.errorCode === 0 || episodes.length > 0),
      errorMessage: json.errorMessage ?? "",
      bangumi: json.bangumi || {
        bangumiId: json.bangumiId || String(animeId),
        animeTitle: json.animeTitle || "",
        episodes,
      },
    };
  }

  async getDanmakuComments(episodeId: number): Promise<DanmakuCommentsResponse> {
    const url = buildDanmakuRequestPath("comments", { episodeId }, this.usesDirectDanmakuApi());
    const response = await this._fetchDanmaku(url);
    // 直连 dandanplay 兼容上游默认返回弹幕 XML，代理模式返回 JSON；统一双格式归一化
    return parseDanmakuCommentsPayload(await response.text());
  }

  async getDanmakuCommentsByUrl(videoUrl: string): Promise<DanmakuCommentsResponse> {
    const url = buildDanmakuRequestPath("commentsByUrl", { videoUrl }, this.usesDirectDanmakuApi());
    const response = await this._fetchDanmaku(url);
    return parseDanmakuCommentsPayload(await response.text());
  }
}

// 默认实例
export let api = new API();
