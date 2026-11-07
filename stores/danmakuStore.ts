import { create } from "zustand";
import Toast from "react-native-toast-message";
import { api } from "@/services/api";
import { DanmakuDisplaySettingsManager } from "@/services/storage";
import Logger from "@/utils/Logger";
import {
  convertDanmakuFormat,
  filterDanmakuSources,
  matchDanmakuEpisode,
  DANMAKU_DEFAULT_AREA,
  DANMAKU_DEFAULT_DENSITY,
  type DanmakuAnime,
  type DanmakuArea,
  type DanmakuDensity,
  type DanmakuEpisode,
  type DanmakuSelection,
  type DisplayDanmaku,
} from "@/utils/danmaku";

const logger = Logger.withTag("DanmakuStore");

function showNoDanmakuToast() {
  Toast.show({
    type: "info",
    text1: "未找到弹幕",
    visibilityTime: 2000,
    autoHide: true,
  });
}

function showDanmakuReadyToast(count: number) {
  Toast.show({
    type: "success",
    text1: `${count}个弹幕已就绪~`,
    visibilityTime: 2000,
    autoHide: true,
  });
}

type ProbedDanmakuSource = {
  anime: DanmakuAnime;
  episodes: DanmakuEpisode[];
  episode: DanmakuEpisode | null;
  comments: DisplayDanmaku[];
  count: number;
};

function mergeCommentCounts(sources: DanmakuAnime[], probed: ProbedDanmakuSource[]): DanmakuAnime[] {
  return sources.map((source) => {
    const hit = probed.find(
      (item) => item.anime.animeId === source.animeId && item.anime.source === source.source
    );
    return hit ? { ...source, commentCount: hit.count } : source;
  });
}

async function probeDanmakuSources(
  animes: DanmakuAnime[],
  episodeIndex: number,
  episodeTitle?: string
): Promise<ProbedDanmakuSource[]> {
  const candidates = animes.slice(0, 6);
  return Promise.all(
    candidates.map(async (anime) => {
      try {
        const response = await api.getDanmakuEpisodes(anime.animeId);
        const list = response.bangumi?.episodes || [];
        const episode = matchDanmakuEpisode(episodeIndex, list, episodeTitle);
        if (!episode) {
          return { anime, episodes: list, episode: null, comments: [], count: 0 };
        }
        const commentRes = await api.getDanmakuComments(episode.episodeId);
        const comments = convertDanmakuFormat(commentRes.comments || []);
        const count = comments.length === 0 ? 0 : commentRes.count > 0 ? commentRes.count : comments.length;
        return { anime, episodes: list, episode, comments, count };
      } catch (error) {
        logger.error("probe danmaku source failed", anime.animeTitle, error);
        return { anime, episodes: [] as DanmakuEpisode[], episode: null, comments: [], count: 0 };
      }
    })
  );
}

interface DanmakuState {
  enabled: boolean;
  loading: boolean;
  showModal: boolean;
  comments: DisplayDanmaku[];
  count: number;
  sources: DanmakuAnime[];
  episodes: DanmakuEpisode[];
  selectedAnime: DanmakuAnime | null;
  selection: DanmakuSelection | null;
  searchKeyword: string;
  searchError: string | null;
  probing: boolean;
  videoTitle: string;
  videoYear?: string;
  episodeIndex: number;
  videoEpisodeTitle?: string;
  opacity: number;
  fontSize: number;
  loadToken: number;
  area: DanmakuArea;
  density: DanmakuDensity;
  setArea: (area: DanmakuArea) => Promise<void>;
  setDensity: (density: DanmakuDensity) => Promise<void>;
  hydrateDisplaySettings: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setShowModal: (show: boolean) => void;
  openModal: () => void;
  setSearchKeyword: (keyword: string) => void;
  reset: () => void;
  loadForPlayback: (options: {
    title: string;
    year?: string;
    episodeIndex: number;
    episodeTitle?: string;
  }) => Promise<void>;
  search: (
    keyword?: string,
    options?: { fromUser?: boolean }
  ) => Promise<{ animes: DanmakuAnime[]; all: DanmakuAnime[] } | null>;
  applyRichestSource: (
    animes: DanmakuAnime[],
    loadToken: number,
    fallbackAnimes?: DanmakuAnime[]
  ) => Promise<void>;
  selectAnime: (anime: DanmakuAnime, sourceIndex?: number) => Promise<void>;
  selectEpisode: (episode: DanmakuEpisode) => Promise<void>;
  loadComments: (episodeId: number, selection: DanmakuSelection, options?: { silent?: boolean }) => Promise<void>;
}

const emptyState = {
  loading: false,
  probing: false,
  comments: [] as DisplayDanmaku[],
  count: 0,
  sources: [] as DanmakuAnime[],
  episodes: [] as DanmakuEpisode[],
  selectedAnime: null as DanmakuAnime | null,
  selection: null as DanmakuSelection | null,
  searchError: null as string | null,
};

const useDanmakuStore = create<DanmakuState>((set, get) => ({
  enabled: true,
  loading: false,
  showModal: false,
  comments: [],
  count: 0,
  sources: [],
  episodes: [],
  selectedAnime: null,
  selection: null,
  searchKeyword: "",
  searchError: null,
  probing: false,
  videoTitle: "",
  videoYear: undefined,
  episodeIndex: 0,
  videoEpisodeTitle: undefined,
  opacity: 0.9,
  fontSize: 16,
  loadToken: 0,
  area: DANMAKU_DEFAULT_AREA,
  density: DANMAKU_DEFAULT_DENSITY,

  setArea: async (area) => {
    set({ area });
    await DanmakuDisplaySettingsManager.save({ area, density: get().density });
  },
  setDensity: async (density) => {
    set({ density });
    await DanmakuDisplaySettingsManager.save({ area: get().area, density });
  },
  hydrateDisplaySettings: async () => {
    const settings = await DanmakuDisplaySettingsManager.get();
    set({ area: settings.area, density: settings.density });
  },

  setEnabled: (enabled) => set({ enabled }),
  toggleEnabled: () => set({ enabled: !get().enabled }),
  setShowModal: (show) => set({ showModal: show }),
  openModal: () => {
    set({ showModal: true });
    const { sources, videoTitle, searchKeyword, searchError, loading } = get();
    if (!sources.length && !searchError && !loading && (searchKeyword || videoTitle)) {
      get().search(searchKeyword || videoTitle, { fromUser: true });
    }
  },
  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),

  reset: () =>
    set({
      ...emptyState,
      showModal: false,
      searchKeyword: "",
      videoTitle: "",
      videoYear: undefined,
      episodeIndex: 0,
      videoEpisodeTitle: undefined,
      loadToken: 0,
    }),

  loadForPlayback: async ({ title, year, episodeIndex, episodeTitle }) => {
    const prevTitle = get().videoTitle;
    const titleChanged = prevTitle !== title;
    const loadToken = get().loadToken + 1;
    set({
      videoTitle: title,
      videoYear: year,
      episodeIndex,
      videoEpisodeTitle: episodeTitle,
      searchKeyword: titleChanged || !get().searchKeyword ? title : get().searchKeyword,
      comments: [],
      count: 0,
      searchError: null,
      loadToken,
      ...(titleChanged ? { selection: null, selectedAnime: null, episodes: [], sources: [] } : {}),
    });

    if (!title) {
      // 空标题时没有后续加载流程接管 loading，在此复位，避免搜索按钮永久禁用
      set({ loading: false });
      return;
    }

    const { selection, selectedAnime, episodes } = get();
    if (!titleChanged && selectedAnime && episodes.length > 0) {
      const episode = matchDanmakuEpisode(episodeIndex, episodes, episodeTitle);
      if (episode) {
        const nextSelection: DanmakuSelection = {
          animeId: selectedAnime.animeId,
          episodeId: episode.episodeId,
          animeTitle: selectedAnime.animeTitle,
          episodeTitle: episode.episodeTitle,
          searchKeyword: get().searchKeyword,
        };
        await get().loadComments(episode.episodeId, nextSelection, { silent: true });
        return;
      }
    }

    if (!titleChanged && selection) {
      await get().loadComments(selection.episodeId, selection, { silent: true });
      return;
    }

    const result = await get().search(title);
    if (get().loadToken !== loadToken) return;
    const matched = result?.animes ?? [];
    if (matched.length === 0) {
      showNoDanmakuToast();
      return;
    }
    await get().applyRichestSource(matched, loadToken, result?.all);
  },

  applyRichestSource: async (animes, loadToken, fallbackAnimes) => {
    // 注意：下方 loadToken 过期时的提前 return 不会复位 loading。
    // 这是有意的：此时必然有更新的搜索持有新的 loadToken，由它负责把 loading 置回 false。
    // 新增任何会 loadToken + 1 的入口时，必须保证该入口自己会把 loading 复位。
    set({ loading: true });
    let probed = await probeDanmakuSources(animes, get().episodeIndex, get().videoEpisodeTitle);

    if (get().loadToken !== loadToken) {
      return;
    }

    let sourcesWithCounts = mergeCommentCounts(get().sources.length ? get().sources : animes, probed);
    let best = probed.reduce((winner, item) => (item.count > winner.count ? item : winner), probed[0]);

    if ((!best || !best.episode || best.count === 0) && fallbackAnimes?.length) {
      const usedIds = new Set(animes.map((item) => item.animeId));
      const rest = fallbackAnimes.filter((item) => !usedIds.has(item.animeId));
      if (rest.length) {
        const extra = await probeDanmakuSources(rest, get().episodeIndex, get().videoEpisodeTitle);
        if (get().loadToken !== loadToken) {
          return;
        }
        const currentSources = sourcesWithCounts.length ? sourcesWithCounts : animes;
        const combined = [
          ...currentSources,
          ...rest.filter((item) => !currentSources.some((s) => s.animeId === item.animeId)),
        ];
        sourcesWithCounts = mergeCommentCounts(combined, extra);
        const extraBest = extra.reduce(
          (winner, item) => (item.count > winner.count ? item : winner),
          extra[0]
        );
        if (extraBest && extraBest.count > (best?.count || 0)) {
          best = extraBest;
        }
      }
    }

    if (!best || !best.episode || best.count === 0) {
      set({ loading: false, comments: [], count: 0, sources: sourcesWithCounts });
      showNoDanmakuToast();
      return;
    }

    const selection: DanmakuSelection = {
      animeId: best.anime.animeId,
      episodeId: best.episode.episodeId,
      animeTitle: best.anime.animeTitle,
      episodeTitle: best.episode.episodeTitle,
      searchKeyword: get().searchKeyword,
    };
    set({
      sources: sourcesWithCounts,
      selectedAnime: { ...best.anime, commentCount: best.count },
      episodes: best.episodes,
      selection,
      comments: best.comments,
      count: best.count,
      loading: false,
      enabled: true,
    });
    showDanmakuReadyToast(best.count);
  },

  search: async (keyword, options) => {
    // fromUser 时递增 loadToken 使进行中的旧搜索全部过期；
    // 过期分支的提前 return 不复位 loading，由持有最新 loadToken 的操作负责复位
    const fromUser = options?.fromUser === true;
    const query = (keyword ?? get().searchKeyword).trim();
    if (!query) {
      const searchError = "请输入搜索关键词";
      set({ searchError });
      return null;
    }
    const loadToken = fromUser ? get().loadToken + 1 : get().loadToken;
    const filterTitle = fromUser ? query : get().videoTitle || query;
    const filterYear = fromUser && query !== get().videoTitle ? undefined : get().videoYear;
    set({
      loading: true,
      probing: false,
      searchError: null,
      searchKeyword: query,
      selectedAnime: null,
      episodes: [],
      ...(fromUser ? { loadToken, sources: [] } : {}),
    });
    try {
      let response;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        if (retryCount > 0) {
          // 指数退避（300ms/600ms），避免网络抖动时重试请求紧挨着发出
          await new Promise((r) => setTimeout(r, 300 * retryCount));
        }
        try {
          logger.info(`Searching danmaku for "${query}" (attempt ${retryCount + 1}/${maxRetries + 1})`);
          response = await api.searchDanmaku(query);
          if (response && response.success) {
            break;
          }
          if (retryCount < maxRetries) {
            logger.warn("Search returned unsuccessful, retrying...", response);
            retryCount++;
          } else {
            logger.error("All search attempts failed", response);
            break;
          }
        } catch (error) {
          logger.error(`Search attempt ${retryCount + 1} failed:`, error);
          if (retryCount >= maxRetries) {
            throw error;
          }
          retryCount++;
        }
      }

      if (get().loadToken !== loadToken) {
        logger.info("Search cancelled (loadToken changed)");
        return null;
      }

      if (!response) {
        throw new Error("No response from danmaku API");
      }

      if (response.success && response.animes?.length) {
        const filtered = filterDanmakuSources(response.animes, filterTitle, filterYear);
        const list = filtered.length ? filtered : response.animes;
        set({ sources: list, loading: false, showModal: fromUser ? true : get().showModal });
        if (get().showModal) {
          set({ probing: true });
          try {
            const probed = await probeDanmakuSources(list, get().episodeIndex, get().videoEpisodeTitle);
            if (get().loadToken !== loadToken) {
              set({ probing: false });
              return { animes: list, all: response.animes };
            }
            set({ sources: mergeCommentCounts(list, probed), probing: false });
          } catch (probeError) {
            logger.error("Failed to probe danmaku sources", probeError);
            set({ probing: false });
          }
        }
        return { animes: list, all: response.animes };
      }
      const searchError =
        response.errorMessage || (fromUser ? "未找到相关弹幕源，请更换关键词重试" : "未找到匹配的弹幕源");
      set({
        sources: [],
        loading: false,
        searchError,
      });
      return { animes: [], all: [] };
    } catch (error) {
      logger.error("search danmaku failed", error);
      if (get().loadToken !== loadToken) {
        return null;
      }
      const searchError = "弹幕搜索失败，请检查后端弹幕配置";
      set({
        sources: [],
        loading: false,
        searchError,
      });
      return null;
    }
  },

  selectAnime: async (anime, _sourceIndex) => {
    const loadToken = get().loadToken;
    set({ selectedAnime: anime, loading: true, searchError: null });
    try {
      const response = await api.getDanmakuEpisodes(anime.animeId);
      const list = response.bangumi?.episodes || [];
      if (get().loadToken !== loadToken) {
        return;
      }
      if (response.success && list.length > 0) {
        set({ episodes: list, loading: false });
        const episode = matchDanmakuEpisode(get().episodeIndex, list, get().videoEpisodeTitle);
        if (episode) {
          await get().selectEpisode(episode);
        }
      } else {
        set({ episodes: [], loading: false, searchError: "该弹幕源暂无分集" });
        if (!get().showModal) showNoDanmakuToast();
      }
    } catch (error) {
      logger.error("get danmaku episodes failed", error);
      if (get().loadToken !== loadToken) {
        return;
      }
      set({ episodes: [], loading: false, searchError: "获取弹幕分集失败" });
    }
  },

  selectEpisode: async (episode) => {
    const anime = get().selectedAnime;
    if (!anime) return;
    const selection: DanmakuSelection = {
      animeId: anime.animeId,
      episodeId: episode.episodeId,
      animeTitle: anime.animeTitle,
      episodeTitle: episode.episodeTitle,
      searchKeyword: get().searchKeyword,
    };
    await get().loadComments(episode.episodeId, selection);
    set({ showModal: false });
  },

  loadComments: async (episodeId, selection, options) => {
    const loadToken = get().loadToken;
    set({ loading: true, selection, searchError: null });
    try {
      const response = await api.getDanmakuComments(episodeId);
      if (get().loadToken !== loadToken) {
        return;
      }
      const comments = convertDanmakuFormat(response.comments || []);
      const count = comments.length === 0 ? 0 : response.count > 0 ? response.count : comments.length;
      const sources = get().sources.map((source) =>
        source.animeId === selection.animeId ? { ...source, commentCount: count } : source
      );
      const selectedAnime = get().selectedAnime;
      set({
        comments,
        count,
        loading: false,
        enabled: true,
        sources,
        selectedAnime: selectedAnime ? { ...selectedAnime, commentCount: count } : selectedAnime,
      });
      if (count === 0) {
        showNoDanmakuToast();
      } else if (!options?.silent) {
        showDanmakuReadyToast(count);
      }
    } catch (error) {
      logger.error("load danmaku comments failed", error);
      if (get().loadToken !== loadToken) {
        return;
      }
      set({ comments: [], count: 0, loading: false, searchError: "加载弹幕失败" });
      showNoDanmakuToast();
    }
  },
}));

export default useDanmakuStore;
