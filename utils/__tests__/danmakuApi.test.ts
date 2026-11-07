import {
  buildDanmakuRequestPath,
  extractDanmakuApiUrl,
  extractDanmakuApiUrlFromHtml,
  normalizeDanmakuApiUrl,
  resolveDanmakuApiFromServer,
} from "../danmakuApi";

describe("extractDanmakuApiUrl", () => {
  it("从常见服务端字段中取出弹幕 API 地址并去掉末尾斜杠", () => {
    expect(extractDanmakuApiUrl({ DanmakuApiBaseUrl: "https://dm.example.com/" })).toBe(
      "https://dm.example.com"
    );
    expect(extractDanmakuApiUrl({ DANMU_API_BASE_URL: "http://192.168.1.7:9321/87654321" })).toBe(
      "http://192.168.1.7:9321/87654321"
    );
    expect(extractDanmakuApiUrl({ SiteConfig: { DanmakuApiBaseUrl: "https://dm.example.com" } })).toBe(
      "https://dm.example.com"
    );
    expect(
      extractDanmakuApiUrl({
        SiteConfig: { DanmakuApiBase: "http://192.168.1.7:9321", DanmakuApiToken: "my-token" },
      })
    ).toBe("http://192.168.1.7:9321/my-token");
    expect(extractDanmakuApiUrl({ SiteConfig: { DanmakuSourceType: "builtin" } })).toBe(
      "https://mtvpls-danmu.netlify.app/87654321"
    );
    expect(
      extractDanmakuApiUrl({
        DanmakuApiBase: "http://192.168.1.7:9321/",
        DanmakuApiToken: "87654321",
      })
    ).toBe("http://192.168.1.7:9321");
  });

  it("没有有效地址时返回空字符串", () => {
    expect(extractDanmakuApiUrl(null)).toBe("");
    expect(extractDanmakuApiUrl({})).toBe("");
    expect(extractDanmakuApiUrl({ DanmakuApiBaseUrl: "   " })).toBe("");
    expect(extractDanmakuApiUrl({ SiteName: "MoonTV", StorageType: "redis" })).toBe("");
  });
});

describe("extractDanmakuApiUrlFromHtml", () => {
  it("从首页注入的 RUNTIME_CONFIG 里解析弹幕 API", () => {
    const html = `<script>window.RUNTIME_CONFIG = ${JSON.stringify({
      STORAGE_TYPE: "redis",
      DANMU_API_BASE_URL: "https://thriving-dragon.netlify.app/",
    })};</script>`;
    expect(extractDanmakuApiUrlFromHtml(html)).toBe("https://thriving-dragon.netlify.app");
  });

  it("页面没有弹幕配置时返回空字符串", () => {
    expect(extractDanmakuApiUrlFromHtml("<html></html>")).toBe("");
    expect(
      extractDanmakuApiUrlFromHtml(`<script>window.RUNTIME_CONFIG = ${JSON.stringify({ STORAGE_TYPE: "redis" })};</script>`)
    ).toBe("");
  });

  it("字符串值里的花括号不会把 JSON 提前截断", () => {
    const html = `<script>window.RUNTIME_CONFIG = ${JSON.stringify({
      SiteName: "My}Site",
      Description: 'say "hello}world"',
      Note: "My{Site}",
      DANMU_API_BASE_URL: "https://brace.example.com/",
    })};</script>`;
    expect(extractDanmakuApiUrlFromHtml(html)).toBe("https://brace.example.com");
  });
});

describe("normalizeDanmakuApiUrl", () => {
  it("去掉首尾空白和末尾斜杠，并补全协议", () => {
    expect(normalizeDanmakuApiUrl(" https://dm.example.com/ ")).toBe("https://dm.example.com");
    expect(normalizeDanmakuApiUrl("https://example.com/api///")).toBe("https://example.com/api");
    expect(normalizeDanmakuApiUrl("192.168.1.7:9321/87654321")).toBe("http://192.168.1.7:9321/87654321");
    expect(normalizeDanmakuApiUrl("dm.example.com")).toBe("https://dm.example.com");
  });

  it("空值保持为空", () => {
    expect(normalizeDanmakuApiUrl("")).toBe("");
    expect(normalizeDanmakuApiUrl("   ")).toBe("");
  });
});

describe("buildDanmakuRequestPath", () => {
  it("未配置独立弹幕 API 时走服务端代理路径", () => {
    expect(buildDanmakuRequestPath("search", { keyword: "凡人修仙传" }, false)).toBe(
      "/api/danmaku/search?keyword=%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E4%BC%A0"
    );
    expect(buildDanmakuRequestPath("episodes", { animeId: 12 }, false)).toBe("/api/danmaku/episodes?animeId=12");
    expect(buildDanmakuRequestPath("comments", { episodeId: 99 }, false)).toBe("/api/danmaku/comment?episodeId=99");
  });

  it("配置了独立弹幕 API 时走弹弹play 兼容路径", () => {
    expect(buildDanmakuRequestPath("search", { keyword: "凡人修仙传" }, true)).toBe(
      "/api/v2/search/anime?keyword=%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E4%BC%A0"
    );
    expect(buildDanmakuRequestPath("episodes", { animeId: 12 }, true)).toBe("/api/v2/bangumi/12");
    expect(buildDanmakuRequestPath("comments", { episodeId: 99 }, true)).toBe("/api/v2/comment/99?format=xml");
    expect(
      buildDanmakuRequestPath("commentsByUrl", { videoUrl: "https://v.example.com/1.mp4" }, true)
    ).toBe("/api/v2/comment?url=https%3A%2F%2Fv.example.com%2F1.mp4&format=xml");
  });
});

describe("resolveDanmakuApiFromServer", () => {
  it("优先使用 server-config 里的弹幕 API", async () => {
    const url = await resolveDanmakuApiFromServer({
      getServerConfig: async () => ({ DanmakuApiBaseUrl: "https://from-config.example.com/" }),
      getHomepageHtml: async () => {
        throw new Error("should not fetch html");
      },
    });
    expect(url).toBe("https://from-config.example.com");
  });

  it("server-config 没有时回退解析首页 RUNTIME_CONFIG", async () => {
    const url = await resolveDanmakuApiFromServer({
      getServerConfig: async () => ({ SiteName: "MoonTV" }),
      getHomepageHtml: async () =>
        `<script>window.RUNTIME_CONFIG = ${JSON.stringify({
          DANMU_API_BASE_URL: "https://from-html.example.com",
        })};</script>`,
    });
    expect(url).toBe("https://from-html.example.com");
  });

  it("两边都没有配置时返回空字符串", async () => {
    const url = await resolveDanmakuApiFromServer({
      getServerConfig: async () => ({ SiteName: "MoonTV" }),
      getHomepageHtml: async () => "<html>no config</html>",
    });
    expect(url).toBe("");
  });

  it("server-config 请求失败时仍尝试解析首页", async () => {
    const url = await resolveDanmakuApiFromServer({
      getServerConfig: async () => {
        throw new Error("404");
      },
      getHomepageHtml: async () =>
        `<script>window.RUNTIME_CONFIG = ${JSON.stringify({
          DANMU_API_BASE_URL: "https://fallback.example.com",
        })};</script>`,
    });
    expect(url).toBe("https://fallback.example.com");
  });
});
