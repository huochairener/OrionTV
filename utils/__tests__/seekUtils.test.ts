import {
  clampRatio,
  ratioFromBarTouch,
  ratioFromSwipe,
  shouldReleaseScrub,
  SWIPE_SEEK_WINDOW_MS,
} from "../seekUtils";

describe("clampRatio", () => {
  it("限制在 0 到 1 之间", () => {
    expect(clampRatio(-0.2)).toBe(0);
    expect(clampRatio(0)).toBe(0);
    expect(clampRatio(0.37)).toBe(0.37);
    expect(clampRatio(1)).toBe(1);
    expect(clampRatio(1.8)).toBe(1);
  });

  it("非有限值视为 0", () => {
    expect(clampRatio(NaN)).toBe(0);
    expect(clampRatio(Infinity)).toBe(0);
  });
});

describe("ratioFromBarTouch", () => {
  const barX = 40;
  const barWidth = 200;

  it("起点、中点、终点分别对应 0 / 0.5 / 1", () => {
    expect(ratioFromBarTouch(40, barX, barWidth)).toBe(0);
    expect(ratioFromBarTouch(140, barX, barWidth)).toBe(0.5);
    expect(ratioFromBarTouch(240, barX, barWidth)).toBe(1);
  });

  it("超出进度条两端时钳制", () => {
    expect(ratioFromBarTouch(0, barX, barWidth)).toBe(0);
    expect(ratioFromBarTouch(400, barX, barWidth)).toBe(1);
  });

  it("宽度无效时返回 0", () => {
    expect(ratioFromBarTouch(100, barX, 0)).toBe(0);
    expect(ratioFromBarTouch(100, barX, -10)).toBe(0);
  });
});

describe("ratioFromSwipe", () => {
  const screenWidth = 800;

  it("无滑动时保持起始进度", () => {
    expect(ratioFromSwipe(0.2, 0, screenWidth, 3_600_000)).toBe(0.2);
  });

  it("时长不超过窗口时，滑过全屏对应整段视频", () => {
    expect(ratioFromSwipe(0, screenWidth, screenWidth, 90_000)).toBe(1);
    expect(ratioFromSwipe(1, -screenWidth, screenWidth, 90_000)).toBe(0);
  });

  it("长视频时全屏滑动只移动窗口时长", () => {
    const duration = 3_600_000;
    const expected = SWIPE_SEEK_WINDOW_MS / duration;
    expect(ratioFromSwipe(0, screenWidth, screenWidth, duration)).toBeCloseTo(expected);
  });

  it("滑动结果钳制在 0 到 1", () => {
    expect(ratioFromSwipe(0.05, -screenWidth, screenWidth, 90_000)).toBe(0);
    expect(ratioFromSwipe(0.95, screenWidth, screenWidth, 90_000)).toBe(1);
  });
});

describe("shouldReleaseScrub", () => {
  it("接近目标进度时释放 scrub", () => {
    expect(shouldReleaseScrub(10_000, 10_800)).toBe(true);
    expect(shouldReleaseScrub(10_000, 13_000)).toBe(false);
  });
});
