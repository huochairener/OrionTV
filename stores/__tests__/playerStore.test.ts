import usePlayerStore, { isSamePlaySource, selectCurrentEpisode } from "../playerStore";
import useDetailStore from "../detailStore";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("react-native-toast-message", () => ({
  show: jest.fn(),
}));

jest.mock("@/services/storage", () => ({
  PlayRecordManager: {
    get: jest.fn(async () => null),
    save: jest.fn(async () => undefined),
  },
  PlayerSettingsManager: {
    get: jest.fn(async () => null),
    save: jest.fn(async () => undefined),
  },
  FavoriteManager: {
    isFavorited: jest.fn(async () => false),
    getAll: jest.fn(async () => ({})),
    toggle: jest.fn(async () => true),
    remove: jest.fn(async () => undefined),
  },
  DanmakuDisplaySettingsManager: {
    get: jest.fn(async () => ({ area: 0.25, density: "medium" })),
    save: jest.fn(async () => undefined),
  },
}));

jest.mock("@/services/api", () => ({
  api: {
    searchVideo: jest.fn(),
    searchVideosWs: jest.fn(),
  },
}));

jest.mock("@react-native-community/netinfo", () => ({
  fetch: jest.fn(async () => ({ type: "wifi" })),
}));

jest.mock("@/services/m3u8", () => ({
  getInfoFromM3U8: jest.fn(),
  getTsSpeed: jest.fn(),
}));

function makeSource(overrides: {
  source: string;
  source_name: string;
  id: number;
  episodes?: string[];
}) {
  return {
    title: "测试剧",
    year: "2024",
    poster: "",
    pingTime: 1,
    firstTsUrl: "",
    speed: 0,
    episodes: overrides.episodes ?? ["https://a.example/1.m3u8", "https://a.example/2.m3u8"],
    ...overrides,
  };
}

describe("handleVideoLoad", () => {
  beforeEach(() => {
    usePlayerStore.getState().reset();
  });

  it("从历史进度起播时，把播放时间拨到起播点，避免字幕还停在开头", async () => {
    usePlayerStore.setState({ initialPosition: 125_000 });
    await usePlayerStore.getState().handleVideoLoad({
      currentTime: 0,
      duration: 1000,
      naturalSize: { width: 1920, height: 1080, orientation: "landscape" },
      audioTracks: [],
      textTracks: [],
      videoTracks: [],
    });
    expect(usePlayerStore.getState().status.positionMillis).toBe(125_000);
  });
});

describe("isSamePlaySource", () => {
  it("相同数字 id 但不同源时不算同一个播放源", () => {
    expect(
      isSamePlaySource({ source: "iqiyi", id: 100 }, { source: "bilibili", id: 100 })
    ).toBe(false);
  });

  it("源和 id 都相同时视为同一个播放源，id 允许数字和字符串", () => {
    expect(
      isSamePlaySource({ source: "iqiyi", id: 100 }, { source: "iqiyi", id: "100" })
    ).toBe(true);
  });
});

describe("playerStore source switch", () => {
  beforeEach(() => {
    usePlayerStore.getState().reset();
    useDetailStore.setState({
      detail: null,
      searchResults: [],
      sources: [],
      loading: false,
      allSourcesLoaded: false,
      failedSources: new Set(),
      error: null,
    });
  });

  it("切换到同 id 的其他源时会换成新源的播放地址", async () => {
    const current = makeSource({
      source: "iqiyi",
      source_name: "爱奇艺",
      id: 100,
      episodes: ["https://iqiyi.example/1.m3u8"],
    });
    const next = makeSource({
      source: "bilibili",
      source_name: "哔哩哔哩",
      id: 100,
      episodes: ["https://bili.example/1.m3u8"],
    });
    useDetailStore.setState({
      detail: current,
      searchResults: [current, next],
      allSourcesLoaded: false,
    });
    usePlayerStore.setState({
      currentEpisodeIndex: 0,
      episodes: [{ url: current.episodes[0], title: "第 1 集" }],
      status: {
        isLoaded: true,
        isPlaying: true,
        durationMillis: 100000,
        positionMillis: 12345,
        playableDurationMillis: 20000,
        didJustFinish: false,
      },
      showSourceModal: true,
      isVideoLoading: false,
    });

    await usePlayerStore.getState().switchSource(next);

    expect(useDetailStore.getState().detail?.source).toBe("bilibili");
    expect(useDetailStore.getState().detail?.source_name).toBe("哔哩哔哩");
    expect(usePlayerStore.getState().episodes[0].url).toBe("https://bili.example/1.m3u8");
    expect(usePlayerStore.getState().initialPosition).toBe(12345);
    expect(usePlayerStore.getState().showSourceModal).toBe(false);
    expect(usePlayerStore.getState().isDetialLoading).toBe(false);
  });

  it("切换播放源时会清掉未完成的 seek 定时器，避免切源后仍改播放状态", async () => {
    jest.useFakeTimers();
    const current = makeSource({
      source: "iqiyi",
      source_name: "爱奇艺",
      id: 100,
      episodes: ["https://iqiyi.example/1.m3u8"],
    });
    const next = makeSource({
      source: "bilibili",
      source_name: "哔哩哔哩",
      id: 100,
      episodes: ["https://bili.example/1.m3u8"],
    });
    useDetailStore.setState({
      detail: current,
      searchResults: [current, next],
    });
    const staleTimeout = setTimeout(() => {
      usePlayerStore.setState({ isSeeking: true, seekPosition: 0.99 });
    }, 500);
    usePlayerStore.setState({
      currentEpisodeIndex: 0,
      episodes: [{ url: current.episodes[0], title: "第 1 集" }],
      status: {
        isLoaded: true,
        isPlaying: true,
        durationMillis: 100000,
        positionMillis: 12345,
        playableDurationMillis: 20000,
        didJustFinish: false,
      },
      isSeeking: true,
      seekPosition: 0.4,
      _seekTimeout: staleTimeout,
    });

    try {
      await usePlayerStore.getState().switchSource(next);

      expect(usePlayerStore.getState().isSeeking).toBe(false);
      expect(usePlayerStore.getState()._seekTimeout).toBeUndefined();

      jest.advanceTimersByTime(1000);

      expect(usePlayerStore.getState().isSeeking).toBe(false);
      expect(usePlayerStore.getState().seekPosition).toBe(0.4);
    } finally {
      jest.useRealTimers();
    }
  });

  it("视频出错且没有可用备源时会关掉加载遮罩", async () => {
    const current = makeSource({
      source: "iqiyi",
      source_name: "爱奇艺",
      id: 1,
    });
    useDetailStore.setState({
      detail: current,
      searchResults: [current],
      failedSources: new Set(),
    });
    usePlayerStore.setState({
      currentEpisodeIndex: 0,
      isVideoLoading: true,
      isDetialLoading: true,
    });

    await usePlayerStore.getState().handleVideoError("network", current.episodes[0]);

    expect(usePlayerStore.getState().isVideoLoading).toBe(false);
    expect(usePlayerStore.getState().isDetialLoading).toBe(false);
  });
});

describe("loadVideo 集数越界钳制", () => {
  beforeEach(() => {
    usePlayerStore.getState().reset();
    useDetailStore.setState({
      detail: null,
      searchResults: [],
      sources: [],
      loading: false,
      allSourcesLoaded: false,
      failedSources: new Set(),
      error: null,
    });
  });

  it("传入超出总集数的 index 时会钳到最后一集，且 selector 不再触发副作用", async () => {
    const current = makeSource({
      source: "iqiyi",
      source_name: "爱奇艺",
      id: 100,
      episodes: ["https://iqiyi.example/1.m3u8", "https://iqiyi.example/2.m3u8", "https://iqiyi.example/3.m3u8"],
    });
    useDetailStore.setState({
      detail: current,
      searchResults: [current],
    });

    const playEpisodeSpy = jest.spyOn(usePlayerStore.getState(), "playEpisode");

    await usePlayerStore.getState().loadVideo({
      source: current.source,
      id: current.id,
      episodeIndex: 99, // 远超总集数
      q: undefined,
      title: current.title,
      year: current.year,
      stype: "tv",
    });

    // 越界 index 被钳到最后一集
    expect(usePlayerStore.getState().currentEpisodeIndex).toBe(2);
    expect(usePlayerStore.getState().episodes).toHaveLength(3);
    expect(usePlayerStore.getState().isDetialLoading).toBe(false);

    // selector 是纯函数：正常返回当前集，不会触发 playEpisode 副作用
    const episode = selectCurrentEpisode(usePlayerStore.getState());
    expect(episode?.url).toBe("https://iqiyi.example/3.m3u8");
    expect(playEpisodeSpy).not.toHaveBeenCalled();

    playEpisodeSpy.mockRestore();
  });

  it("传入负数或 NaN 时钳到第一集", async () => {
    const current = makeSource({
      source: "iqiyi",
      source_name: "爱奇艺",
      id: 100,
      episodes: ["https://iqiyi.example/1.m3u8", "https://iqiyi.example/2.m3u8"],
    });
    useDetailStore.setState({
      detail: current,
      searchResults: [current],
    });

    await usePlayerStore.getState().loadVideo({
      source: current.source,
      id: current.id,
      episodeIndex: -5,
      q: undefined,
      title: current.title,
      year: current.year,
      stype: "tv",
    });

    expect(usePlayerStore.getState().currentEpisodeIndex).toBe(0);
  });
});

describe("commitScrub", () => {
  const loadedStatus = {
    isLoaded: true,
    isPlaying: true,
    durationMillis: 100000,
    positionMillis: 10000,
    playableDurationMillis: 20000,
    didJustFinish: false,
  };

  beforeEach(() => {
    usePlayerStore.getState().reset();
  });

  afterEach(() => {
    usePlayerStore.getState().reset();
    jest.useRealTimers();
  });

  it("不传比例时提交最后一次拖动位置", async () => {
    jest.useFakeTimers();
    usePlayerStore.setState({
      isSeeking: true,
      seekPosition: 0.42,
      progressPosition: 0.1,
      status: loadedStatus,
    });

    await usePlayerStore.getState().commitScrub();

    expect(usePlayerStore.getState().seekPosition).toBe(0.42);
    expect(usePlayerStore.getState().progressPosition).toBe(0.42);
  });

  it("传入 NaN 会被钳成片头，所以松手时不能把无效坐标交进来", async () => {
    jest.useFakeTimers();
    usePlayerStore.setState({
      isSeeking: true,
      seekPosition: 0.42,
      progressPosition: 0.1,
      status: loadedStatus,
    });

    await usePlayerStore.getState().commitScrub(Number.NaN);

    expect(usePlayerStore.getState().seekPosition).toBe(0);
    expect(usePlayerStore.getState().progressPosition).toBe(0);
  });
});
