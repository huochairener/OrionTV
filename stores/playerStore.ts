import { create } from "zustand";
import Toast from "react-native-toast-message";
import { VideoRef, OnLoadData, OnProgressData, OnPlaybackStateChangedData } from 'react-native-video';
import { RefObject } from "react";
import { PlayRecord, PlayRecordManager, PlayerSettingsManager, FavoriteManager } from "@/services/storage";
import useDetailStore, { episodesSelectorBySource, SearchResultWithResolution } from "./detailStore";
import Logger from '@/utils/Logger';
import { clampRatio, shouldReleaseScrub } from "@/utils/seekUtils";

const logger = Logger.withTag('PlayerStore');

export function isSamePlaySource(
  current?: { source?: string; id?: string | number } | null,
  next?: { source?: string; id?: string | number } | null
): boolean {
  if (!current || !next) return false;
  return current.source === next.source && String(current.id) === String(next.id);
}

function toVideoId(id: string | number): number {
  return typeof id === "number" ? id : parseInt(id, 10);
}

interface Episode {
  url: string;
  title: string;
}

interface VideoStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  durationMillis: number;
  positionMillis: number;
  playableDurationMillis: number;
  didJustFinish: boolean;
}

interface PlayerState {
  videoRef: RefObject<VideoRef> | null;
  currentEpisodeIndex: number;
  episodes: Episode[];
  status: VideoStatus;
  isDetialLoading: boolean;
  isVideoLoading: boolean;
  showControls: boolean;
  showLockControls: boolean;
  showEpisodeModal: boolean;
  showSourceModal: boolean;
  showSpeedModal: boolean;
  showNextEpisodeOverlay: boolean;
  isSeeking: boolean;
  seekPosition: number;
  progressPosition: number;
  bufferedPosition: number;
  initialPosition: number;
  playbackRate: number;
  isLandscapeMode: boolean | null;
  introEndTime?: number;
  outroStartTime?: number;
  isFavorited: boolean;
  setVideoRef: (ref: RefObject<VideoRef>) => void;
  loadVideo: (options: {
    source: string;
    id: number | string;
    q?: string;
    title: string;
    year: string;
    stype: string;
    episodeIndex: number;
    position?: number;
  }) => Promise<void>;
  switchSource: (detail: SearchResultWithResolution) => Promise<void>;
  playEpisode: (index: number) => void;
  togglePlayPause: () => void;
  seek: (duration: number) => void;
  startScrub: (ratio: number) => void;
  updateScrub: (ratio: number) => void;
  commitScrub: (ratio?: number) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setShowControls: (show: boolean) => void;
  setShowEpisodeModal: (show: boolean) => void;
  setShowSourceModal: (show: boolean) => void;
  setShowSpeedModal: (show: boolean) => void;
  setShowNextEpisodeOverlay: (show: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setIntroEndTime: () => void;
  setOutroStartTime: () => void;
  reset: () => void;
  toggleFavorite:  () => void;
  toggleLock:  () => void;
  _seekTimeout?: NodeJS.Timeout;
  _isRecordSaveThrottled: boolean;
  // Internal helper
  savePlayRecord: (updates?: Partial<PlayRecord>, options?: { immediate?: boolean }) => Promise<void>;
  handleVideoError: (errorType: 'ssl' | 'network' | 'other', failedUrl: string) => Promise<void>;
  handleVideoLoad: (data: OnLoadData) => void;
  handleVideoProgress: (data: OnProgressData) => void;
  handleVideoPlaybackStateChanged : (data: OnPlaybackStateChangedData) => void;
  handleVideoEnd: () => void;
}

const usePlayerStore = create<PlayerState>((set, get) => ({
  videoRef: null,
  episodes: [],
  currentEpisodeIndex: -1,
  status: {
    isLoaded: false,
    isPlaying: false,
    durationMillis: 0,
    positionMillis: 0,
    playableDurationMillis: 0,
    didJustFinish: false,
  },
  isDetialLoading: true,
  isVideoLoading: false,
  showControls: false,
  showLockControls: false,
  showEpisodeModal: false,
  showSourceModal: false,
  showSpeedModal: false,
  showNextEpisodeOverlay: false,
  isSeeking: false,
  seekPosition: 0,
  progressPosition: 0,
  bufferedPosition: 0,
  initialPosition: 0,
  playbackRate: 1.0,
  isLandscapeMode: null,
  introEndTime: undefined,
  outroStartTime: undefined,
  _seekTimeout: undefined,
  _isRecordSaveThrottled: false,
  isFavorited: false,

  setVideoRef: (ref) => set({ videoRef: ref }),

  loadVideo: async ({ source, id, episodeIndex, position, q, title, year, stype }) => {
    const videoId = toVideoId(id);
    const perfStart = performance.now();
    logger.info(`[PERF] PlayerStore.loadVideo START - source: ${source}, id: ${videoId}, q: ${q}, title: ${title}, year: ${year}, stype: ${stype}`);
    
    let detail = useDetailStore.getState().detail;
    let episodes: string[] = [];
    
    // 如果有detail，使用detail的source获取episodes；否则使用传入的source
    if (detail && isSamePlaySource(detail, { source, id: videoId })) {
      logger.info(`[INFO] Using existing detail source "${detail.source}" and id "${detail.id}" to get episodes`);
      episodes = episodesSelectorBySource(detail.source, detail.id)(useDetailStore.getState());
    } else {
      logger.info(`[INFO] No existing detail, using provided source "${source}" to get episodes`);
      episodes = episodesSelectorBySource(source, videoId)(useDetailStore.getState());
    }

    set({
      isDetialLoading: true,
    });
    
    // 已经拿到当前源的剧集时不要因为后台还在搜其他源就重新 init，否则会清空 detail 卡死播放页
    const needsDetailInit = !detail || !episodes || episodes.length === 0 || detail.title !== title;
    logger.info(`[PERF] Detail check - needsInit: ${needsDetailInit}, hasDetail: ${!!detail}, episodesCount: ${episodes?.length || 0}`);
    
    if (needsDetailInit) {

      const detailInitStart = performance.now();
      logger.info(`[PERF] DetailStore.init START - ${q}, ${title}`);
      useDetailStore.setState({
        loading: true
      });
      useDetailStore.getState().init(q, title, year, stype, source, String(videoId));

      while(true) {
        // 第一个结果返回就开始播放
        if(!useDetailStore.getState().loading)break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const detailInitEnd = performance.now();
      logger.info(`[PERF] DetailStore.init END - took ${(detailInitEnd - detailInitStart).toFixed(2)}ms`);
      
      detail = useDetailStore.getState().detail;
      
      if (!detail) {
        logger.error(`[ERROR] Detail not found after initialization for "${title}" (source: ${source}, id: ${videoId})`);
        
        // 检查DetailStore的错误状态
        const detailStoreState = useDetailStore.getState();
        if (detailStoreState.error) {
          logger.error(`[ERROR] DetailStore error: ${detailStoreState.error}`);
          set({ 
            isDetialLoading: false,
            // 可以选择在这里设置一个错误状态，但playerStore可能没有error字段
          });
        } else {
          logger.error(`[ERROR] DetailStore init completed but no detail found and no error reported`);
          set({ isDetialLoading: false });
        }
        return;
      }
      
      // 使用DetailStore找到的实际source来获取episodes，而不是原始的preferredSource
      logger.info(`[INFO] Using actual source "${detail.source}" instead of preferred source "${source}"`);  
      episodes = episodesSelectorBySource(detail.source, detail.id)(useDetailStore.getState());
      
      if (!episodes || episodes.length === 0) {
        logger.error(`[ERROR] No episodes found for "${title}" from source "${detail.source}" (${detail.source_name})`);
        
        // 尝试从searchResults中直接获取episodes
        const detailStoreState = useDetailStore.getState();
        logger.info(`[INFO] Available sources in searchResults: ${detailStoreState.searchResults.map(r => `${r.source}(${r.episodes?.length || 0} episodes)`).join(', ')}`);
        
        // 如果当前source没有episodes，尝试使用第一个有episodes的source
        const sourceWithEpisodes = detailStoreState.searchResults.find(r => r.episodes && r.episodes.length > 0);
        if (sourceWithEpisodes) {
          logger.info(`[FALLBACK] Using alternative source "${sourceWithEpisodes.source}" with ${sourceWithEpisodes.episodes.length} episodes`);
          episodes = sourceWithEpisodes.episodes;
          // 更新detail为有episodes的source
          detail = sourceWithEpisodes;
        } else {
          logger.error(`[ERROR] No source with episodes found in searchResults`);
          set({ isDetialLoading: false });
          return;
        }
      }
      
      logger.info(`[SUCCESS] Detail and episodes loaded - source: ${detail.source_name}, episodes: ${episodes.length}`);
    } else {
      logger.info(`[PERF] Skipping DetailStore.init - using cached data`);
      if (detail && !isSamePlaySource(detail, { source, id: videoId })) {
        const requested = useDetailStore.getState().searchResults.find(
          (r) => r.source === source && r.id === videoId
        );
        if (requested) {
          logger.info(`[INFO] Updating detail to requested source "${source}"`);
          detail = requested;
          await useDetailStore.getState().setDetail(requested);
        }
      }
    }
    
    // 最终验证：确保我们有有效的detail和episodes数据
    if (!detail) {
      logger.error(`[ERROR] Final check failed: detail is null`);
      set({ isDetialLoading: false });
      return;
    }
    
    if (!episodes || episodes.length === 0) {
      logger.error(`[ERROR] Final check failed: no episodes available for source "${detail.source}" (${detail.source_name})`);
      set({ isDetialLoading: false });
      return;
    }
    
    logger.info(`[SUCCESS] Final validation passed - detail: ${detail.source_name}, episodes: ${episodes.length}`);

    try {
      const storageStart = performance.now();
      logger.info(`[PERF] Storage operations START`);
      
      const playRecord = await PlayRecordManager.get(detail!.source, detail!.id.toString());
      const storagePlayRecordEnd = performance.now();
      logger.info(`[PERF] PlayRecordManager.get took ${(storagePlayRecordEnd - storageStart).toFixed(2)}ms`);
      
      const playerSettings = await PlayerSettingsManager.get(detail!.source, detail!.id.toString());
      const storageEnd = performance.now();
      logger.info(`[PERF] PlayerSettingsManager.get took ${(storageEnd - storagePlayRecordEnd).toFixed(2)}ms`);
      logger.info(`[PERF] Total storage operations took ${(storageEnd - storageStart).toFixed(2)}ms`);
      
      const initialPositionFromRecord = playRecord?.play_time ? playRecord.play_time * 1000 : 0;
      const savedPlaybackRate = playerSettings?.playbackRate || 1.0;
      
      const episodesMappingStart = performance.now();
      const mappedEpisodes = episodes.map((ep, index) => ({
        url: ep,
        title: `第 ${index + 1} 集`,
      }));
      const episodesMappingEnd = performance.now();
      logger.info(`[PERF] Episodes mapping (${episodes.length} episodes) took ${(episodesMappingEnd - episodesMappingStart).toFixed(2)}ms`);
      
      let isFavorited = await FavoriteManager.isFavorited(source, String(videoId));
      if (!isFavorited) {
        const favoritesData = await FavoriteManager.getAll();
        const arrFavoritesData = Object.entries(favoritesData).map(item =>{
          const [source, id] = item[0].split("+");
          return {...item[1], source, id};
        })
        const findedFavorite = arrFavoritesData.find(item => {
          const itemStype = item.total_episodes > 1 ? 'tv' : 'movie';
          return item.title.replace(' ', '') == title && item.year == year && (stype !== undefined && itemStype === stype || stype === undefined)
        });
        if (findedFavorite) {
          await FavoriteManager.remove(findedFavorite.source, findedFavorite.id);
          const { poster, source_name } = detail;
          const favoriteItem = {
            cover: poster,
            title,
            poster,
            source_name,
            total_episodes: episodes.length,
            search_title: q,
            year: year || "",
          };
          const newIsFavorited = await FavoriteManager.toggle(source, String(videoId), favoriteItem);
          isFavorited = true;
        }
      }

      // 路由/收藏带入的集数可能越界（旧深链指向更多集、换到集数更少的源），
      // 写入 store 前钳制到新源范围内，保证 currentEpisodeIndex 永远有效，
      // selectCurrentEpisode 才能保持纯函数而不在 selector 里调用 playEpisode
      const safeEpisodeIndex = Number.isFinite(episodeIndex)
        ? Math.min(Math.max(episodeIndex, 0), mappedEpisodes.length - 1)
        : 0;

      set({
        isDetialLoading: false,
        currentEpisodeIndex: safeEpisodeIndex,
        initialPosition: position || initialPositionFromRecord,
        playbackRate: savedPlaybackRate,
        episodes: mappedEpisodes,
        introEndTime: playRecord?.introEndTime || playerSettings?.introEndTime,
        outroStartTime: playRecord?.outroStartTime || playerSettings?.outroStartTime,
        isFavorited: isFavorited,
      });
      
      const perfEnd = performance.now();
      logger.info(`[PERF] PlayerStore.loadVideo COMPLETE - total time: ${(perfEnd - perfStart).toFixed(2)}ms`);
      
    } catch (error) {
      logger.debug("Failed to load play record", error);
      set({ isDetialLoading: false });
      
      const perfEnd = performance.now();
      logger.info(`[PERF] PlayerStore.loadVideo ERROR - total time: ${(perfEnd - perfStart).toFixed(2)}ms`);
    }
  },

  switchSource: async (newDetail) => {
    const { currentEpisodeIndex, status, _seekTimeout } = get();
    if (!newDetail?.episodes?.length) {
      set({ showSourceModal: false, isVideoLoading: false });
      Toast.show({ type: "error", text1: "该播放源暂无可用剧集" });
      return;
    }

    if (isSamePlaySource(useDetailStore.getState().detail, newDetail)) {
      set({ showSourceModal: false });
      return;
    }

    if (_seekTimeout) {
      clearTimeout(_seekTimeout);
    }

    const currentPosition = status?.isLoaded ? status.positionMillis : 0;
    await useDetailStore.getState().setDetail(newDetail);

    const episodeIndex = Math.min(
      Math.max(currentEpisodeIndex, 0),
      newDetail.episodes.length - 1
    );
    const mappedEpisodes = newDetail.episodes.map((ep, index) => ({
      url: ep,
      title: `第 ${index + 1} 集`,
    }));

    set({
      episodes: mappedEpisodes,
      currentEpisodeIndex: episodeIndex,
      initialPosition: currentPosition || 0,
      // 新源未加载前清零展示比例，避免进度条/缓冲条沿用旧源的进度
      // （seekPosition 仅在 isSeeking 时展示，保留旧值可验证过期定时器已被清除）
      progressPosition: 0,
      bufferedPosition: 0,
      isDetialLoading: false,
      isVideoLoading: true,
      showSourceModal: false,
      showNextEpisodeOverlay: false,
      isSeeking: false,
      _seekTimeout: undefined,
      status: {
        ...get().status,
        isLoaded: false,
      },
    });
  },

  playEpisode: async (index) => {
    const { episodes, videoRef, _seekTimeout } = get();
    // 清除 seek 定时器，防止上一集的 seek 操作影响新集
    if (_seekTimeout) {
      clearTimeout(_seekTimeout);
    }
    if (index >= 0 && index < episodes.length) {
      set({
        currentEpisodeIndex: index,
        showNextEpisodeOverlay: false,
        initialPosition: 0,
        progressPosition: 0,
        seekPosition: 0,
        isSeeking: false,
        _seekTimeout: undefined,
      });
      try {
        await videoRef?.current?.seek(0);
        await videoRef?.current?.resume();

      } catch (error) {
        logger.debug("Failed to replay video:", error);
        Toast.show({ type: "error", text1: "播放失败" });
      }
    }
  },

  togglePlayPause: async () => {
    const { status, videoRef } = get();
    if (status?.isLoaded) {
      try {
        if (status?.isPlaying) {
          await videoRef?.current?.pause();
        }
        else {
          await videoRef?.current?.resume();
        }
      } catch (error) {
        logger.debug("Failed to toggle play/pause:", error);
        Toast.show({ type: "error", text1: "操作失败" });
      }
    }
  },

  toggleFavorite: async () => {
    const { q, detail } = useDetailStore.getState();
    if (!detail) return;

    const { source, id, title, poster, source_name, episodes, year } = detail;

    const favoriteItem = {
      cover: poster,
      title,
      poster,
      source_name,
      total_episodes: episodes.length,
      search_title: q,
      year: year || "",
    };

    const newIsFavorited = await FavoriteManager.toggle(source, id.toString(), favoriteItem);
    set({ isFavorited: newIsFavorited });
  },

  // 切换锁定状态
  toggleLock: async () => {
    const { showLockControls } = get();
    set({
      showLockControls: !showLockControls
    });
  },

  startScrub: (ratio) => {
    const seekTimeout = get()._seekTimeout;
    if (seekTimeout) {
      clearTimeout(seekTimeout);
      set({ _seekTimeout: undefined });
    }
    set({
      isSeeking: true,
      seekPosition: clampRatio(ratio),
    });
  },

  updateScrub: (ratio) => {
    if (!get().isSeeking) return;
    set({ seekPosition: clampRatio(ratio) });
  },

  commitScrub: async (ratio) => {
    const { status, videoRef, seekPosition, _seekTimeout } = get();
    if (_seekTimeout) {
      clearTimeout(_seekTimeout);
    }
    if (!status?.isLoaded || !status.durationMillis) {
      set({ isSeeking: false, _seekTimeout: undefined });
      return;
    }

    const r = clampRatio(ratio ?? seekPosition);
    const newPosition = r * status.durationMillis;
    set({
      isSeeking: true,
      seekPosition: r,
      progressPosition: r,
      _seekTimeout: undefined,
    });

    try {
      await videoRef?.current?.seek(newPosition / 1000);
    } catch (error) {
      logger.debug("Failed to seek video:", error);
      Toast.show({ type: "error", text1: "快进/快退失败" });
      set({ isSeeking: false, _seekTimeout: undefined });
      return;
    }

    const timeoutId = setTimeout(() => {
      if (get().isSeeking) {
        set({ isSeeking: false, _seekTimeout: undefined });
      }
    }, 1200);
    set({ _seekTimeout: timeoutId });
  },

  seek: async (duration) => {
    const { isSeeking, status, seekPosition } = get();
    if (!status?.isLoaded || !status.durationMillis) return;

    const lastPositionMillis = isSeeking ? seekPosition * status.durationMillis : status.positionMillis;
    const newPosition = Math.max(0, Math.min(lastPositionMillis + duration, status.durationMillis));
    const ratio = newPosition / status.durationMillis;

    get().startScrub(ratio);

    const seekTimeout = get()._seekTimeout;
    if (seekTimeout) {
      clearTimeout(seekTimeout);
    }
    const timeoutId = setTimeout(() => {
      get().commitScrub(ratio);
    }, 500);
    set({ _seekTimeout: timeoutId });
  },

  setIntroEndTime: () => {
    const { status, introEndTime: existingIntroEndTime } = get();
    const detail = useDetailStore.getState().detail;
    if (!status?.isLoaded || !detail) return;

    if (existingIntroEndTime) {
      // Clear the time
      set({ introEndTime: undefined });
      get().savePlayRecord({ introEndTime: undefined }, { immediate: true });
      Toast.show({
        type: "info",
        text1: "已清除片头时间",
      });
    } else {
      // Set the time
      const newIntroEndTime = status.positionMillis;
      set({ introEndTime: newIntroEndTime });
      get().savePlayRecord({ introEndTime: newIntroEndTime }, { immediate: true });
      Toast.show({
        type: "success",
        text1: "设置成功",
        text2: "片头时间已记录。",
      });
    }
  },

  setOutroStartTime: () => {
    const { status, outroStartTime: existingOutroStartTime } = get();
    const detail = useDetailStore.getState().detail;
    if (!status?.isLoaded || !detail) return;

    if (existingOutroStartTime) {
      // Clear the time
      set({ outroStartTime: undefined });
      get().savePlayRecord({ outroStartTime: undefined }, { immediate: true });
      Toast.show({
        type: "info",
        text1: "已清除片尾时间",
      });
    } else {
      // Set the time
      if (!status.durationMillis) return;
      const newOutroStartTime = status.durationMillis - status.positionMillis;
      set({ outroStartTime: newOutroStartTime });
      get().savePlayRecord({ outroStartTime: newOutroStartTime }, { immediate: true });
      Toast.show({
        type: "success",
        text1: "设置成功",
        text2: "片尾时间已记录。",
      });
    }
  },

  savePlayRecord: async (updates = {}, options = {}) => {
    const { immediate = false } = options;
    if (!immediate) {
      if (get()._isRecordSaveThrottled) {
        return;
      }
      set({ _isRecordSaveThrottled: true });
      setTimeout(() => {
        set({ _isRecordSaveThrottled: false });
      }, 10000); // 10 seconds
    }

    const { q, detail } = useDetailStore.getState();
    const { currentEpisodeIndex, episodes, status, introEndTime, outroStartTime } = get();
    if (detail && status?.isLoaded) {
      const existingRecord = {
        introEndTime,
        outroStartTime,
      };
      await PlayRecordManager.save(detail.source, detail.id.toString(), {
        title: detail.title,
        search_title: q,
        cover: detail.poster || "",
        index: currentEpisodeIndex + 1,
        total_episodes: episodes.length,
        play_time: Math.floor(status.positionMillis / 1000),
        total_time: status.durationMillis ? Math.floor(status.durationMillis / 1000) : 0,
        source_name: detail.source_name,
        year: detail.year || "",
        ...existingRecord,
        ...updates,
      });
    }
  },

  setLoading: (loading) => set({ isDetialLoading: loading }),
  setShowControls: (show) => set({ showControls: show }),
  setShowEpisodeModal: (show) => set({ showEpisodeModal: show }),
  setShowSourceModal: (show) => set({ showSourceModal: show }),
  setShowSpeedModal: (show) => set({ showSpeedModal: show }),
  setShowNextEpisodeOverlay: (show) => set({ showNextEpisodeOverlay: show }),

  setPlaybackRate: async (rate) => {
    const detail = useDetailStore.getState().detail;
    
    try {
      set({ playbackRate: rate });
      
      // Save the playback rate preference
      if (detail) {
        await PlayerSettingsManager.save(detail.source, detail.id.toString(), { playbackRate: rate });
      }
    } catch (error) {
      logger.debug("Failed to set playback rate:", error);
    }
  },

  reset: () => {
    const seekTimeout = get()._seekTimeout;
    if (seekTimeout) {
      clearTimeout(seekTimeout);
    }
    set({
      episodes: [],
      currentEpisodeIndex: 0,
      status: {
        isLoaded: false,
        isPlaying: false,
        durationMillis: 0,
        positionMillis: 0,
        playableDurationMillis: 0,
        didJustFinish: false,
      },
      isDetialLoading: true,
      isVideoLoading: false,
      showControls: false,
      showLockControls: false,
      showEpisodeModal: false,
      showSourceModal: false,
      showSpeedModal: false,
      showNextEpisodeOverlay: false,
      initialPosition: 0,
      playbackRate: 1.0,
      introEndTime: undefined,
      outroStartTime: undefined,
      isLandscapeMode: null,
      isSeeking: false,
      seekPosition: 0,
      progressPosition: 0,
      _seekTimeout: undefined,
    });
    useDetailStore.getState().abort();
  },

  handleVideoLoad: async (data: OnLoadData) => {
    try {
      const { videoRef, initialPosition, introEndTime, status  } = get();
      const durationMillis = (data.duration || 0) * 1000;
      // 1. 先设置位置（如果需要）
      // 切换源时保留的旧进度可能超过新源时长，seek 超出会导致黑屏/直接结束
      let jumpPosition = initialPosition || introEndTime || 0;
      if (jumpPosition > 0 && durationMillis > 0) {
        jumpPosition = Math.min(jumpPosition, Math.max(durationMillis - 5000, 0));
      }
      if (jumpPosition > 0) {
        logger.info(`[PERF] Setting initial position to ${jumpPosition}ms`);
        await videoRef?.current?.seek(jumpPosition / 1000);
        await videoRef?.current?.resume();
      }

      // 根据视频高宽比, 决定是否切换为横屏
      const { width, height } = data.naturalSize;

      const newStatus = {
        ...status,
        isLoaded: true,
        durationMillis: durationMillis || status.durationMillis,
        positionMillis: jumpPosition > 0 ? jumpPosition : status.positionMillis,
      }

      set({
        status: newStatus,
        isLandscapeMode: width > height,
        isVideoLoading: false,
      });
      logger.info(`[PERF] Video loading complete - isDetialLoading set to false`);

    } catch (error) {
      logger.warn(`[AUTOPLAY] Failed to auto-play after onLoad:`, error);
      // 即使自动播放失败，也要设置加载完成状态
      set({ isVideoLoading: false });
      // 不显示错误提示，因为自动播放失败是常见且预期的情况
    }
  },

  handleVideoError: async (errorType: 'ssl' | 'network' | 'other', failedUrl: string) => {
    const perfStart = performance.now();
    logger.error(`[VIDEO_ERROR] Handling ${errorType} error for URL: ${failedUrl}`);
    
    const detailStoreState = useDetailStore.getState();
    const { detail } = detailStoreState;
    const { currentEpisodeIndex } = get();
    
    if (!detail) {
      logger.error(`[VIDEO_ERROR] Cannot fallback - no detail available`);
      set({ isDetialLoading: false, isVideoLoading: false });
      return;
    }
    
    // 标记当前source为失败
    const currentSource = detail.source;
    const errorReason = `${errorType} error: ${failedUrl.substring(0, 100)}...`;
    useDetailStore.getState().markSourceAsFailed(currentSource, errorReason);
    
    // 获取下一个可用的source
    const fallbackSource = useDetailStore.getState().getNextAvailableSource(currentSource, currentEpisodeIndex);
    
    if (!fallbackSource) {
      logger.error(`[VIDEO_ERROR] No fallback sources available for episode ${currentEpisodeIndex + 1}`);
      Toast.show({ 
        type: "error", 
        text1: "播放失败", 
        text2: "所有播放源都不可用，请稍后重试" 
      });
      set({ isDetialLoading: false, isVideoLoading: false });
      return;
    }
    
    logger.info(`[VIDEO_ERROR] Switching to fallback source: ${fallbackSource.source} (${fallbackSource.source_name})`);
    
    try {
      // 更新DetailStore的当前detail为fallback source
      await useDetailStore.getState().setDetail(fallbackSource);
      
      // 重新加载当前集数的episodes
      const newEpisodes = fallbackSource.episodes || [];
      if (newEpisodes.length > currentEpisodeIndex) {
        const mappedEpisodes = newEpisodes.map((ep, index) => ({
          url: ep,
          title: `第 ${index + 1} 集`,
        }));
        
        set({
          episodes: mappedEpisodes,
          isDetialLoading: false, // 让Video组件重新渲染
          isVideoLoading: true,
        });
        
        const perfEnd = performance.now();
        logger.info(`[VIDEO_ERROR] Successfully switched to fallback source in ${(perfEnd - perfStart).toFixed(2)}ms`);
        logger.info(`[VIDEO_ERROR] New episode URL: ${newEpisodes[currentEpisodeIndex].substring(0, 100)}...`);
        
        Toast.show({ 
          type: "success", 
          text1: "已切换播放源", 
          text2: `正在使用 ${fallbackSource.source_name}` 
        });
      } else {
        logger.error(`[VIDEO_ERROR] Fallback source doesn't have episode ${currentEpisodeIndex + 1}`);
        set({ isDetialLoading: false, isVideoLoading: false });
      }
    } catch (error) {
      logger.error(`[VIDEO_ERROR] Failed to switch to fallback source:`, error);
      set({ isDetialLoading: false, isVideoLoading: false });
    }
  },
  
  // 播放进度更新
  handleVideoProgress: (data) => {
    const positionMillis = data.currentTime * 1000;
    const playableDurationMillis = data.playableDuration * 1000;
    const { currentEpisodeIndex, episodes, outroStartTime, playEpisode, status, isSeeking, seekPosition, _seekTimeout } = get();
    const durationMillis = Math.max((data.seekableDuration || 0) * 1000, status.durationMillis || 0);
    const detail = useDetailStore.getState().detail;

    const bufferedPosition = durationMillis ? playableDurationMillis / durationMillis : 0;
    const progressPosition = durationMillis ? positionMillis / durationMillis : 0;

    if (isSeeking) {
      const targetMillis = seekPosition * durationMillis;
      if (!shouldReleaseScrub(positionMillis, targetMillis)) {
        set({
          status: {
            ...status,
            durationMillis,
            playableDurationMillis,
          },
          bufferedPosition,
        });
        return;
      }
      if (_seekTimeout) {
        clearTimeout(_seekTimeout);
      }
      set({
        isSeeking: false,
        _seekTimeout: undefined,
        status: {
          ...status,
          durationMillis,
          positionMillis,
          playableDurationMillis,
        },
        progressPosition,
        bufferedPosition,
      });
      return;
    }

    if (
      outroStartTime &&
      durationMillis &&
      positionMillis >= durationMillis - outroStartTime
    ) {
      if (currentEpisodeIndex < episodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
        return; // Stop further processing for this update
      }
    }

    if (detail && durationMillis) {
      get().savePlayRecord();

      const isNearEnd = positionMillis / durationMillis > 0.95;
      if (isNearEnd && currentEpisodeIndex < episodes.length - 1 && !outroStartTime) {
        set({ showNextEpisodeOverlay: true });
      } else {
        set({ showNextEpisodeOverlay: false });
      }
    }

    const newStatus = {
      ...status,
      durationMillis,
      positionMillis,
      playableDurationMillis
    };

    set({ status : newStatus, progressPosition, bufferedPosition });
  },

  // 视频播放结束
  handleVideoEnd: () => {
    const { currentEpisodeIndex, episodes, playEpisode } = get();
    if (currentEpisodeIndex < episodes.length - 1) {
      playEpisode(currentEpisodeIndex + 1);
    }
  },

  handleVideoPlaybackStateChanged: (data) => {
    const { isPlaying } = data;
    const { status } = get();
    const newStatus = {
      ...status,
      isPlaying,
    };

    set({
      status: newStatus
    });
  }

}));

export default usePlayerStore;

export const selectCurrentEpisode = (state: PlayerState) => {
  // 纯 selector，不允许副作用：React 渲染（尤其 StrictMode 双调用）可能多次执行 selector，
  // 旧实现在越界时调用 playEpisode 会触发重复 seek/resume。
  // 越界钳制改由写入端保证（loadVideo/switchSource 在 set 前钳制 currentEpisodeIndex）。
  if (
    state.episodes &&
    Array.isArray(state.episodes) &&
    state.episodes.length > 0 &&
    state.currentEpisodeIndex >= 0 &&
    state.currentEpisodeIndex < state.episodes.length
  ) {
    const episode = state.episodes[state.currentEpisodeIndex];
    // 确保episode有有效的URL
    if (episode && episode.url && episode.url.trim() !== "") {
      return episode;
    } else {
      // 仅在调试模式下打印
      if (__DEV__) {
        logger.debug(`[PERF] selectCurrentEpisode - episode found but invalid URL: ${episode?.url}`);
      }
    }
  } else {
    // 仅在调试模式下打印
    if (__DEV__) {
      logger.debug(`[PERF] selectCurrentEpisode - no valid episode: episodes.length=${state.episodes?.length}, currentIndex=${state.currentEpisodeIndex}`);
    }
  }
  return undefined;
};
