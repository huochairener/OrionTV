import { create } from "zustand";
import { SettingsManager } from "@/services/storage";
import { api, ServerConfig } from "@/services/api";
import { storageConfig } from "@/services/storageConfig";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";
import useDetailStore from "./detailStore";
import { clearM3u8Cache } from "@/services/m3u8";
import { normalizeBaseUrl, resolveDanmakuApiFromServer } from "@/utils/danmakuApi";

const logger = Logger.withTag('SettingsStore');

interface SettingsState {
  apiBaseUrl: string;
  m3u8Proxy: string;
  danmakuApiUrl: string;
  isFetchingDanmakuApi: boolean;
  m3uUrl: string;
  m3uUa: string;
  remoteInputEnabled: boolean;
  videoSource: {
    enabledAll: boolean;
    sources: {
      [key: string]: boolean;
    };
  };
  isModalVisible: boolean;
  serverConfig: ServerConfig | null;
  isLoadingServerConfig: boolean;
  loadSettings: () => Promise<void>;
  fetchServerConfig: () => Promise<void>;
  fetchLiveSource: () => Promise<void>;
  fetchDanmakuApiConfig: () => Promise<string>;
  setApiBaseUrl: (url: string) => void;
  setM3u8Proxy: (url: string) => void;
  setDanmakuApiUrl: (url: string) => void;
  setRemoteInputEnabled: (enabled: boolean) => void;
  saveSettings: () => Promise<void>;
  setVideoSource: (config: { enabledAll: boolean; sources: { [key: string]: boolean } }) => void;
  showModal: () => void;
  hideModal: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiBaseUrl: "",
  m3u8Proxy: '',
  danmakuApiUrl: "",
  isFetchingDanmakuApi: false,
  m3uUrl: "",
  m3uUa: '',
  remoteInputEnabled: false,
  isModalVisible: false,
  serverConfig: null,
  isLoadingServerConfig: false,
  videoSource: {
    enabledAll: true,
    sources: {},
  },
  loadSettings: async () => {
    const settings = await SettingsManager.get();
    set({
      apiBaseUrl: settings.apiBaseUrl,
      m3u8Proxy: settings.m3u8Proxy,
      danmakuApiUrl: settings.danmakuApiUrl || "",
      remoteInputEnabled: settings.remoteInputEnabled || false,
      videoSource: settings.videoSource || {
        enabledAll: true,
        sources: {},
      },
    });
    api.setDanmakuBaseUrl(settings.danmakuApiUrl || "");
    if (settings.apiBaseUrl) {
      api.setBaseUrl(settings.apiBaseUrl);
      await get().fetchServerConfig();
      await get().fetchLiveSource();
    }
  },
  fetchServerConfig: async () => {
    set({ isLoadingServerConfig: true });
    try {
      const config = await api.getServerConfig();
      if (config) {
        storageConfig.setStorageType(config.StorageType);
        set({ serverConfig: config });
      }
    } catch (error) {
      set({ serverConfig: null });
      logger.error("Failed to fetch server config:", error);
    } finally {
      set({ isLoadingServerConfig: false });
    }
  },
  fetchLiveSource: async () => {
    const ret = await api.getLiveSource();
    const sources = ret.data;
    if (sources.length>0) {
      const source = sources[0];
      set({ 
        m3uUrl: source.url,
        m3uUa: source.ua
      });
      logger.info(`Live source url: ${source.url}, ua: ${source.ua}`);
    }
  },
  setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
  setM3u8Proxy: (url) => set({ m3u8Proxy: url }),
  setDanmakuApiUrl: (url) => set({ danmakuApiUrl: url }),
  setRemoteInputEnabled: (enabled) => set({ remoteInputEnabled: enabled }),
  setVideoSource: (config) => set({ videoSource: config }),
  fetchDanmakuApiConfig: async () => {
    set({ isFetchingDanmakuApi: true });
    try {
      const url = await resolveDanmakuApiFromServer({
        getServerConfig: () => api.getServerConfig(),
        getHomepageHtml: () => api.fetchHomepageHtml(),
      });
      if (url) {
        set({ danmakuApiUrl: url });
        api.setDanmakuBaseUrl(url);
      }
      return url;
    } catch (error) {
      logger.error("Failed to fetch danmaku API config:", error);
      return "";
    } finally {
      set({ isFetchingDanmakuApi: false });
    }
  },
  saveSettings: async () => {
    const { apiBaseUrl, m3u8Proxy, danmakuApiUrl, remoteInputEnabled, videoSource } = get();

    const currentSettings = await SettingsManager.get()
    const currentApiBaseUrl = currentSettings.apiBaseUrl;
    const currentM3u8Proxy = currentSettings.m3u8Proxy;
    const processedApiBaseUrl = normalizeBaseUrl(apiBaseUrl);

    const processedM3u8Proxy = m3u8Proxy && m3u8Proxy + (m3u8Proxy.endsWith('/') ? '' : '/') || '';
    const processedDanmakuApiUrl = normalizeBaseUrl(danmakuApiUrl);

    await SettingsManager.save({
      apiBaseUrl: processedApiBaseUrl,
      m3u8Proxy: processedM3u8Proxy,
      danmakuApiUrl: processedDanmakuApiUrl,
      remoteInputEnabled,
      videoSource,
    });
    if ( currentApiBaseUrl !== processedApiBaseUrl) {
      await AsyncStorage.setItem('authCookies', '');
    }
    if (currentM3u8Proxy !== processedM3u8Proxy) {
      // 重置detail信息
      useDetailStore.setState({detail: null});
      clearM3u8Cache();
    }
    api.setBaseUrl(processedApiBaseUrl);
    api.setDanmakuBaseUrl(processedDanmakuApiUrl);
    // Also update the URL in the state so the input field shows the processed URL
    set({
      isModalVisible: false,
      apiBaseUrl: processedApiBaseUrl,
      m3u8Proxy: processedM3u8Proxy,
      danmakuApiUrl: processedDanmakuApiUrl,
    });
    await get().fetchServerConfig();
  },
  showModal: () => set({ isModalVisible: true }),
  hideModal: () => set({ isModalVisible: false }),
}));
