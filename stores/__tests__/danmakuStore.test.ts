import Toast from "react-native-toast-message";
import { api } from "@/services/api";
import { DanmakuDisplaySettingsManager } from "@/services/storage";
import useDanmakuStore from "../danmakuStore";

jest.mock("react-native-toast-message", () => ({
  show: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  api: {
    searchDanmaku: jest.fn(),
    getDanmakuEpisodes: jest.fn(),
    getDanmakuComments: jest.fn(),
  },
}));

jest.mock("@/services/storage", () => ({
  DanmakuDisplaySettingsManager: {
    get: jest.fn(async () => ({ area: 0.25, density: "medium" })),
    save: jest.fn(async () => undefined),
  },
}));

const mockedToast = Toast as jest.Mocked<typeof Toast>;
const mockedApi = api as jest.Mocked<typeof api>;

describe("danmakuStore loadForPlayback toasts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDanmakuStore.getState().reset();
  });

  it("搜索并应用弹幕后提示对应源的弹幕数量已就绪", async () => {
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 1,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "iqiyi",
          episodeCount: 10,
        },
        {
          animeId: 2,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockImplementation(async (animeId: number) => ({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: String(animeId),
        animeTitle: "权力的游戏",
        episodes: [{ episodeId: animeId * 100, episodeTitle: "第1集" }],
      },
    }));
    mockedApi.getDanmakuComments.mockImplementation(async (episodeId: number) => {
      if (episodeId === 100) {
        return {
          count: 3,
          comments: [
            { p: "1,1,25,16777215,0,0,0,1", m: "少", cid: 1 },
            { p: "2,1,25,16777215,0,0,0,2", m: "量", cid: 2 },
            { p: "3,1,25,16777215,0,0,0,3", m: "弹幕", cid: 3 },
          ],
        };
      }
      return {
        count: 1888,
        comments: Array.from({ length: 1888 }, (_, i) => ({
          p: `${i},1,25,16777215,0,0,0,${i}`,
          m: `弹幕${i}`,
          cid: i,
        })),
      };
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "权力的游戏",
      year: "2011",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "1888个弹幕已就绪~",
        visibilityTime: 2000,
        autoHide: true,
      })
    );
    expect(mockedToast.show).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "xxx个弹幕已就绪~",
      })
    );
    const sources = useDanmakuStore.getState().sources;
    expect(sources.find((item) => item.source === "bilibili")?.commentCount).toBe(1888);
    expect(sources.find((item) => item.source === "iqiyi")?.commentCount).toBe(3);
    expect(useDanmakuStore.getState().count).toBe(1888);
  });

  it("弹幕源弹窗搜索结果会带上各源弹幕条数", async () => {
    useDanmakuStore.setState({
      showModal: true,
      episodeIndex: 0,
      videoEpisodeTitle: "第1集",
      videoTitle: "权力的游戏",
    });
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 2,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "2",
        animeTitle: "权力的游戏",
        episodes: [{ episodeId: 200, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 1888,
      comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
    });

    await useDanmakuStore.getState().search("权力的游戏");

    expect(useDanmakuStore.getState().sources[0].commentCount).toBe(1888);
  });

  it("未找到弹幕时提示未找到弹幕", async () => {
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [],
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "不存在的剧",
      episodeIndex: 0,
    });

    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "未找到弹幕",
        visibilityTime: 2000,
        autoHide: true,
      })
    );
  });

  it("初次自动搜索无结果后打开面板仍可重新搜索", async () => {
    mockedApi.searchDanmaku
      .mockResolvedValueOnce({
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [],
      })
      .mockResolvedValueOnce({
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [
          {
            animeId: 8,
            animeTitle: "后来找到的剧",
            type: "tv",
            typeDescription: "tv",
            source: "bilibili",
            episodeCount: 1,
          },
        ],
      });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "8",
        animeTitle: "后来找到的剧",
        episodes: [{ episodeId: 80, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({ count: 0, comments: [] });

    await useDanmakuStore.getState().loadForPlayback({
      title: "不存在的剧",
      episodeIndex: 0,
    });

    useDanmakuStore.getState().openModal();
    expect(mockedApi.searchDanmaku).toHaveBeenCalledTimes(1);
    await useDanmakuStore.getState().search("后来找到的剧", { fromUser: true });

    expect(mockedApi.searchDanmaku).toHaveBeenCalledTimes(2);
    expect(useDanmakuStore.getState().loading).toBe(false);
    expect(useDanmakuStore.getState().sources[0].animeId).toBe(8);
  });

  it("搜到源但没有弹幕内容时仍提示未找到弹幕", async () => {
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 1,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "1",
        animeTitle: "权力的游戏",
        episodes: [{ episodeId: 101, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 0,
      comments: [],
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "权力的游戏",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "未找到弹幕",
        visibilityTime: 2000,
        autoHide: true,
      })
    );
    expect(mockedToast.show).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text1: expect.stringContaining("已就绪"),
      })
    );
  });

  it("精确标题年份匹配没有弹幕时会回退到其他有弹幕的源", async () => {
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 1,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "iqiyi",
          startDate: "2011-01",
          episodeCount: 10,
        },
        {
          animeId: 2,
          animeTitle: "权力的游戏 第一季",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          startDate: "2011-01",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockImplementation(async (animeId: number) => ({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: String(animeId),
        animeTitle: animeId === 1 ? "权力的游戏" : "权力的游戏 第一季",
        episodes: [{ episodeId: animeId * 100, episodeTitle: "第1集" }],
      },
    }));
    mockedApi.getDanmakuComments.mockImplementation(async (episodeId: number) => {
      if (episodeId === 100) {
        return { count: 0, comments: [] };
      }
      return {
        count: 88,
        comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
      };
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "权力的游戏",
      year: "2011",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    expect(useDanmakuStore.getState().count).toBe(88);
    expect(useDanmakuStore.getState().selection?.animeId).toBe(2);
  });
});

describe("danmakuStore manual search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDanmakuStore.getState().reset();
  });

  it("弹窗里搜索会立刻列出结果，不必等弹幕条数探测完成", async () => {
    let resolveEpisodes: (value: unknown) => void = () => undefined;
    const episodesPending = new Promise((resolve) => {
      resolveEpisodes = resolve;
    });
    useDanmakuStore.setState({
      showModal: true,
      videoTitle: "未匹配的剧",
      searchKeyword: "权力的游戏",
    });
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 9,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockImplementation(async () => {
      await episodesPending;
      return {
        success: true,
        errorCode: 0,
        errorMessage: "",
        bangumi: {
          bangumiId: "9",
          animeTitle: "权力的游戏",
          episodes: [{ episodeId: 900, episodeTitle: "第1集" }],
        },
      };
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 12,
      comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
    });

    const searchPromise = useDanmakuStore.getState().search("权力的游戏", { fromUser: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(useDanmakuStore.getState().sources).toHaveLength(1);
    expect(useDanmakuStore.getState().sources[0].animeId).toBe(9);
    expect(useDanmakuStore.getState().loading).toBe(false);

    resolveEpisodes({});
    await searchPromise;
  });

  it("用户手动搜索不会被进行中的自动加载覆盖", async () => {
    let resolveAutoSearch: (value: unknown) => void = () => undefined;
    const autoSearchPending = new Promise((resolve) => {
      resolveAutoSearch = resolve;
    });

    mockedApi.searchDanmaku.mockImplementation(async (keyword: string) => {
      if (keyword === "自动标题") {
        await autoSearchPending;
        return {
          success: true,
          errorCode: 0,
          errorMessage: "",
          animes: [
            {
              animeId: 1,
              animeTitle: "自动标题",
              type: "tv",
              typeDescription: "tv",
              source: "iqiyi",
              episodeCount: 1,
            },
          ],
        };
      }
      return {
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [
          {
            animeId: 2,
            animeTitle: "手动关键词",
            type: "tv",
            typeDescription: "tv",
            source: "bilibili",
            episodeCount: 8,
          },
        ],
      };
    });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "1",
        animeTitle: "x",
        episodes: [{ episodeId: 11, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({ count: 0, comments: [] });

    const autoLoad = useDanmakuStore.getState().loadForPlayback({
      title: "自动标题",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    useDanmakuStore.setState({ showModal: true });
    await useDanmakuStore.getState().search("手动关键词", { fromUser: true });

    resolveAutoSearch({});
    await autoLoad;

    expect(useDanmakuStore.getState().searchKeyword).toBe("手动关键词");
    expect(useDanmakuStore.getState().sources.map((item) => item.animeId)).toEqual([2]);
  });

  it("搜索接口失败时会再试一次", async () => {
    mockedApi.searchDanmaku
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [
          {
            animeId: 3,
            animeTitle: "权力的游戏",
            type: "tv",
            typeDescription: "tv",
            source: "bilibili",
            episodeCount: 10,
          },
        ],
      });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "3",
        animeTitle: "权力的游戏",
        episodes: [{ episodeId: 30, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 5,
      comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "权力的游戏",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    expect(mockedApi.searchDanmaku).toHaveBeenCalledTimes(2);
    expect(useDanmakuStore.getState().count).toBe(5);
  });

  it("用户手动搜索会立刻进入搜索中并清空旧结果", async () => {
    let resolveSearch: (value: unknown) => void = () => undefined;
    const searchPending = new Promise((resolve) => {
      resolveSearch = resolve;
    });
    useDanmakuStore.setState({
      showModal: true,
      sources: [
        {
          animeId: 1,
          animeTitle: "旧结果",
          type: "tv",
          typeDescription: "tv",
          source: "iqiyi",
          episodeCount: 1,
        },
      ],
    });
    mockedApi.searchDanmaku.mockImplementation(async () => {
      await searchPending;
      return {
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [
          {
            animeId: 2,
            animeTitle: "新结果",
            type: "tv",
            typeDescription: "tv",
            source: "bilibili",
            episodeCount: 8,
          },
        ],
      };
    });

    const searchPromise = useDanmakuStore.getState().search("新结果", { fromUser: true });
    await Promise.resolve();

    expect(useDanmakuStore.getState().loading).toBe(true);
    expect(useDanmakuStore.getState().sources).toEqual([]);
    expect(useDanmakuStore.getState().searchError).toBeNull();

    resolveSearch({});
    await searchPromise;
  });

  it("用户手动搜索找到源时不弹 toast，结果直接列在面板中", async () => {
    useDanmakuStore.setState({ showModal: true });
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 2,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
        {
          animeId: 3,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "iqiyi",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "2",
        animeTitle: "权力的游戏",
        episodes: [{ episodeId: 200, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({ count: 0, comments: [] });

    await useDanmakuStore.getState().search("权力的游戏", { fromUser: true });

    expect(useDanmakuStore.getState().selectedAnime).toBeNull();
    expect(useDanmakuStore.getState().showModal).toBe(true);
    expect(useDanmakuStore.getState().comments).toEqual([]);
    expect(useDanmakuStore.getState().sources).toHaveLength(2);
    expect(mockedToast.show).not.toHaveBeenCalled();
  });

  it("自动搜索无结果后，手动搜到的源可以点选并播放弹幕", async () => {
    mockedApi.searchDanmaku
      .mockResolvedValueOnce({
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [],
      })
      .mockResolvedValueOnce({
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [
          {
            animeId: 8,
            animeTitle: "剧A",
            type: "tv",
            typeDescription: "tv",
            source: "bilibili",
            episodeCount: 1,
          },
          {
            animeId: 9,
            animeTitle: "剧B",
            type: "tv",
            typeDescription: "tv",
            source: "iqiyi",
            episodeCount: 1,
          },
        ],
      });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "8",
        animeTitle: "剧A",
        episodes: [{ episodeId: 80, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 6,
      comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "不存在的剧",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    useDanmakuStore.setState({ showModal: true });
    await useDanmakuStore.getState().search("后来找到的剧", { fromUser: true });

    expect(useDanmakuStore.getState().sources.map((item) => item.animeId)).toEqual([8, 9]);
    expect(useDanmakuStore.getState().selectedAnime).toBeNull();
    expect(useDanmakuStore.getState().count).toBe(0);

    await useDanmakuStore.getState().selectAnime(useDanmakuStore.getState().sources[0]);

    expect(useDanmakuStore.getState().count).toBe(6);
    expect(useDanmakuStore.getState().comments).toHaveLength(1);
    expect(useDanmakuStore.getState().showModal).toBe(false);
  });

  it("用户手动搜索未找到时面板中提示未找到并引导更换关键词", async () => {
    useDanmakuStore.setState({ showModal: true });
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [],
    });

    await useDanmakuStore.getState().search("不存在的剧", { fromUser: true });

    expect(useDanmakuStore.getState().searchError).toBe("未找到相关弹幕源，请更换关键词重试");
    expect(mockedToast.show).not.toHaveBeenCalled();
  });

  it("用户手动搜索失败时面板中提示弹幕搜索失败", async () => {
    useDanmakuStore.setState({ showModal: true });
    mockedApi.searchDanmaku.mockRejectedValue(new Error("network"));

    await useDanmakuStore.getState().search("权力的游戏", { fromUser: true });

    expect(useDanmakuStore.getState().searchError).toBe("弹幕搜索失败，请检查后端弹幕配置");
    expect(mockedToast.show).not.toHaveBeenCalled();
  });

  it("用户手动搜索空关键词时面板中提示请输入搜索关键词", async () => {
    useDanmakuStore.setState({ showModal: true, searchKeyword: "   " });

    await useDanmakuStore.getState().search(undefined, { fromUser: true });

    expect(useDanmakuStore.getState().searchError).toBe("请输入搜索关键词");
    expect(mockedToast.show).not.toHaveBeenCalled();
    expect(mockedApi.searchDanmaku).not.toHaveBeenCalled();
  });

  it("过期搜索完成时不会清掉进行中搜索的 loading", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const firstPending = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond: (value: unknown) => void = () => undefined;
    const secondPending = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    useDanmakuStore.setState({ showModal: true });
    let callCount = 0;
    mockedApi.searchDanmaku.mockImplementation(async () => {
      callCount += 1;
      await (callCount === 1 ? firstPending : secondPending);
      return {
        success: true,
        errorCode: 0,
        errorMessage: "",
        animes: [
          {
            animeId: callCount,
            animeTitle: `结果${callCount}`,
            type: "tv",
            typeDescription: "tv",
            source: "bilibili",
            episodeCount: 1,
          },
        ],
      };
    });

    const firstSearch = useDanmakuStore.getState().search("第一次", { fromUser: true });
    const secondSearch = useDanmakuStore.getState().search("第二次", { fromUser: true });

    resolveFirst({ success: true, errorCode: 0, errorMessage: "", animes: [] });
    await Promise.resolve();
    await Promise.resolve();

    // 第一次搜索已过期，但不能把它进行中的第二次搜索的 loading 清掉
    expect(useDanmakuStore.getState().loading).toBe(true);

    resolveSecond({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 2,
          animeTitle: "第二次",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 1,
        },
      ],
    });
    await Promise.all([firstSearch, secondSearch]);

    expect(useDanmakuStore.getState().loading).toBe(false);
    expect(useDanmakuStore.getState().sources[0].animeId).toBe(2);
  });

  it("手动搜索成功后先进入弹幕数统计状态，统计完成后结束", async () => {
    let resolveEpisodes: (value: unknown) => void = () => undefined;
    const episodesPending = new Promise((resolve) => {
      resolveEpisodes = resolve;
    });
    useDanmakuStore.setState({ showModal: true, videoTitle: "未匹配的剧" });
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 9,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockImplementation(async () => {
      await episodesPending;
      return {
        success: true,
        errorCode: 0,
        errorMessage: "",
        bangumi: {
          bangumiId: "9",
          animeTitle: "权力的游戏",
          episodes: [{ episodeId: 900, episodeTitle: "第1集" }],
        },
      };
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 12,
      comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
    });

    const searchPromise = useDanmakuStore.getState().search("权力的游戏", { fromUser: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(useDanmakuStore.getState().probing).toBe(true);
    expect(useDanmakuStore.getState().loading).toBe(false);

    resolveEpisodes(undefined);
    await searchPromise;

    expect(useDanmakuStore.getState().probing).toBe(false);
    expect(useDanmakuStore.getState().sources[0].commentCount).toBe(12);
  });

  it("自动播放加载不会弹出找到几个弹幕源", async () => {
    mockedApi.searchDanmaku.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      animes: [
        {
          animeId: 2,
          animeTitle: "权力的游戏",
          type: "tv",
          typeDescription: "tv",
          source: "bilibili",
          episodeCount: 10,
        },
      ],
    });
    mockedApi.getDanmakuEpisodes.mockResolvedValue({
      success: true,
      errorCode: 0,
      errorMessage: "",
      bangumi: {
        bangumiId: "2",
        animeTitle: "权力的游戏",
        episodes: [{ episodeId: 200, episodeTitle: "第1集" }],
      },
    });
    mockedApi.getDanmakuComments.mockResolvedValue({
      count: 5,
      comments: [{ p: "1,1,25,16777215,0,0,0,1", m: "弹幕", cid: 1 }],
    });

    await useDanmakuStore.getState().loadForPlayback({
      title: "权力的游戏",
      episodeIndex: 0,
      episodeTitle: "第1集",
    });

    expect(mockedToast.show).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "找到 1 个弹幕源",
      })
    );
    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: "5个弹幕已就绪~",
      })
    );
  });

  it("空标题中断加载时复位 loading，不会卡住搜索按钮", async () => {
    useDanmakuStore.setState({ loading: true });

    await useDanmakuStore.getState().loadForPlayback({
      title: "",
      episodeIndex: 0,
    });

    expect(useDanmakuStore.getState().loading).toBe(false);
    expect(mockedApi.searchDanmaku).not.toHaveBeenCalled();
  });
});

describe("danmaku display settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDanmakuStore.setState({
      area: 0.25,
      density: "medium",
      comments: [{ text: "x", time: 1, color: "#ffffff", mode: 0 }],
      count: 1,
    });
  });

  it("setArea / setDensity 写入 store 并持久化", async () => {
    await useDanmakuStore.getState().setArea(0.5);
    await useDanmakuStore.getState().setDensity("sparse");
    expect(useDanmakuStore.getState().area).toBe(0.5);
    expect(useDanmakuStore.getState().density).toBe("sparse");
    expect(DanmakuDisplaySettingsManager.save).toHaveBeenCalledWith({ area: 0.5, density: "medium" });
    expect(DanmakuDisplaySettingsManager.save).toHaveBeenCalledWith({ area: 0.5, density: "sparse" });
  });

  it("hydrate 用本地缓存覆盖默认值", async () => {
    (DanmakuDisplaySettingsManager.get as jest.Mock).mockResolvedValueOnce({
      area: 0.75,
      density: "unlimited",
    });
    await useDanmakuStore.getState().hydrateDisplaySettings();
    expect(useDanmakuStore.getState().area).toBe(0.75);
    expect(useDanmakuStore.getState().density).toBe("unlimited");
  });

  it("reset 不清显示区域和密度", () => {
    useDanmakuStore.setState({ area: 0.75, density: "sparse" });
    useDanmakuStore.getState().reset();
    expect(useDanmakuStore.getState().area).toBe(0.75);
    expect(useDanmakuStore.getState().density).toBe("sparse");
    expect(useDanmakuStore.getState().comments).toEqual([]);
  });
});
