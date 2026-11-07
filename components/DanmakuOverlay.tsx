import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import useDanmakuStore from "@/stores/danmakuStore";
import usePlayerStore from "@/stores/playerStore";
import {
  DANMAKU_TRACK_GAP,
  VIDEO_CLOCK_SNAP_SEC,
  collectActiveDanmaku,
  danmakuDuration,
  danmakuMaxFlying,
  danmakuScrollProgress,
  danmakuTrackCount,
  danmakuTrackToY,
  estimateDanmakuWidth,
  filterDanmakuByDensity,
  fixedDanmakuOpacity,
  interpolateVideoTime,
  pickDanmakuTrack,
  reconcileVideoClock,
  remainingScrollMs,
  scrollTranslateX,
  shouldRefreshVideoClock,
  type VideoClockSnapshot,
  type VideoClockSyncState,
} from "@/utils/danmaku";

type LiveItem = {
  key: string;
  text: string;
  color: string;
  y: number;
  startTime: number;
  duration: number;
  width: number;
  mode: number;
  translateX: Animated.Value;
  opacityValue: Animated.Value;
  // mode 0 的滚动位移由原生驱动的线性 timing 承担，JS 每帧不再 setValue 桥接；
  // 暂停/倍速/跳变时按视频时钟重新对齐并重启动画
  anim: Animated.CompositeAnimation | null;
  animWall: number; // 当前动画的起始墙钟时刻(ms)
  animElapsed: number; // 起始时刻弹幕已进行的视频秒数
  lastOpacity: number; // mode≠0：上次写入的不透明度，驻停期为常数时跳过重复桥接
};

export const DanmakuOverlay: React.FC = () => {
  const enabled = useDanmakuStore((s) => s.enabled);
  const comments = useDanmakuStore((s) => s.comments);
  const opacity = useDanmakuStore((s) => s.opacity);
  const fontSize = useDanmakuStore((s) => s.fontSize);
  const area = useDanmakuStore((s) => s.area);
  const density = useDanmakuStore((s) => s.density);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [live, setLive] = useState<LiveItem[]>([]);

  const visibleComments = useMemo(
    () => filterDanmakuByDensity(comments, density),
    [comments, density]
  );

  const liveRef = useRef<LiveItem[]>([]);
  const tracksRef = useRef<number[]>([]);
  const commentsRef = useRef(visibleComments);
  const fontSizeRef = useRef(fontSize);
  const screenWidthRef = useRef(screenWidth);
  const screenHeightRef = useRef(screenHeight);
  const areaRef = useRef(area);
  const densityRef = useRef(density);
  const opacityRef = useRef(opacity);
  const lastVideoTimeRef = useRef(Number.NaN);
  const clockRef = useRef<VideoClockSnapshot>({ time: 0, wall: Date.now(), playing: false, rate: 1 });
  const syncRef = useRef<VideoClockSyncState>({ videoTime: 0, playing: false, rate: 1 });

  commentsRef.current = visibleComments;
  fontSizeRef.current = fontSize;
  screenWidthRef.current = screenWidth;
  screenHeightRef.current = screenHeight;
  areaRef.current = area;
  densityRef.current = density;
  opacityRef.current = opacity;

  useEffect(() => {
    const syncClock = () => {
      const state = usePlayerStore.getState();
      const durationSec = (state.status.durationMillis || 0) / 1000;
      const videoTime = state.isSeeking
        ? state.seekPosition * durationSec
        : (state.status.positionMillis || 0) / 1000;
      const playing = !!state.status.isPlaying && !state.isSeeking;
      const next = { videoTime, playing, rate: state.playbackRate || 1 };
      if (!shouldRefreshVideoClock(syncRef.current, next)) return;
      syncRef.current = next;
      clockRef.current = reconcileVideoClock(clockRef.current, next, Date.now());
    };
    syncClock();
    return usePlayerStore.subscribe(syncClock);
  }, []);

  useEffect(() => {
    if (!enabled || visibleComments.length === 0) {
      liveRef.current = [];
      tracksRef.current = [];
      lastVideoTimeRef.current = Number.NaN;
      setLive([]);
      return;
    }

    let raf = 0;
    let cancelled = false;
    let lastWall = 0;
    let lastPlaying = false;
    let lastRate = 1;
    // 滚动位移已交由原生驱动，tick 仅负责弹幕生成/移除与跳变检测，TV 按 ~30fps 轮询即可
    const minTickIntervalMs = Platform.isTV ? Math.floor(1000 / 30) : 0;
    // 原生动画按墙钟线性推进，与视频时钟偏差超过该值（秒）时重新对齐，
    // 兜底处理低于跳变阈值的小幅 seek、播放卡顿等场景
    const nativeDriftToleranceSec = 0.1;

    const startScrollTiming = (item: LiveItem, elapsedSec: number, rate: number, now: number) => {
      const anim = Animated.timing(item.translateX, {
        toValue: -item.width,
        duration: Math.max(16, remainingScrollMs(item.duration, elapsedSec) / rate),
        easing: Easing.linear,
        useNativeDriver: true,
      });
      item.anim = anim;
      item.animWall = now;
      item.animElapsed = Math.max(0, elapsedSec);
      anim.start(({ finished }) => {
        if (finished && item.anim === anim) item.anim = null;
      });
    };

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      if (minTickIntervalMs > 0 && now - lastWall < minTickIntervalMs - 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const clock = clockRef.current;
      const prevVideoTime = lastVideoTimeRef.current;
      const t = interpolateVideoTime(clock, now);
      // 跳变判定基于「相对墙钟推进量的位移」：低帧率时帧间隔可能超过阈值，
      // 直接比较帧间差会把正常播放误判为跳变，导致轨道被反复重建
      const expectedDelta =
        lastWall > 0 ? ((now - lastWall) / 1000) * (clock.playing ? clock.rate || 1 : 0) : 0;
      const jumped =
        Number.isFinite(prevVideoTime) &&
        Math.abs(t - prevVideoTime - expectedDelta) > VIDEO_CLOCK_SNAP_SEC;

      const playing = clock.playing;
      const rate = clock.rate || 1;
      // 播放/暂停/倍速变化，或暂停期间的进度预览（拖动进度条）发生位移时，
      // 原生动画需要重新对齐到视频时钟
      const clockSynced =
        playing !== lastPlaying ||
        rate !== lastRate ||
        (!playing && Number.isFinite(prevVideoTime) && Math.abs(t - prevVideoTime) > 0.05);
      lastVideoTimeRef.current = t;
      lastWall = now;
      lastPlaying = playing;
      lastRate = rate;

      const size = fontSizeRef.current;
      const renderedSize = Platform.isTV ? size + 6 : size;
      const width = screenWidthRef.current;
      const height = screenHeightRef.current;
      const trackCount = danmakuTrackCount(height, size, areaRef.current);
      let prev = liveRef.current;
      let rebuilt = false;
      if (jumped || tracksRef.current.length !== trackCount) {
        tracksRef.current = new Array(trackCount).fill(-999);
        prev = [];
        rebuilt = true;
      }

      const active = collectActiveDanmaku(
        commentsRef.current,
        t,
        danmakuMaxFlying(densityRef.current)
      );
      const prevByKey = new Map(prev.map((item) => [item.key, item]));
      const next: LiveItem[] = [];

      for (const comment of active) {
        const key = String(comment.index);
        const duration = danmakuDuration(comment.mode);
        let item = prevByKey.get(key);
        const created = !item;
        if (!item) {
          const itemWidth = estimateDanmakuWidth(comment.text, renderedSize);
          const track = pickDanmakuTrack(
            comment.time,
            comment.mode,
            tracksRef.current,
            DANMAKU_TRACK_GAP,
            densityRef.current !== "sparse"
          );
          if (track < 0) continue;
          const progress = danmakuScrollProgress(comment.time, t, duration);
          item = {
            key,
            text: comment.text,
            color: comment.color,
            y: danmakuTrackToY(track, comment.mode, height, size, tracksRef.current.length, areaRef.current),
            startTime: comment.time,
            duration,
            width: itemWidth,
            mode: comment.mode,
            translateX: new Animated.Value(
              comment.mode === 0 ? scrollTranslateX(width, itemWidth, progress) : 0
            ),
            opacityValue: new Animated.Value(
              comment.mode === 0 ? 1 : fixedDanmakuOpacity(comment.time, t, duration, opacityRef.current)
            ),
            anim: null,
            animWall: 0,
            animElapsed: 0,
            lastOpacity:
              comment.mode === 0 ? 1 : fixedDanmakuOpacity(comment.time, t, duration, opacityRef.current),
          };
        } else if (comment.mode === 0 && clockSynced) {
          // 暂停/倍速变化/进度预览位移：对齐到当前视频时钟后按需重启原生动画
          // （setValue 会自动停掉运行中的原生动画）
          const progress = danmakuScrollProgress(comment.time, t, duration);
          item.translateX.setValue(scrollTranslateX(width, item.width, progress));
          if (playing) {
            startScrollTiming(item, progress * duration, rate, now);
          } else {
            item.anim = null;
          }
        } else if (comment.mode === 0 && playing && item.anim) {
          // 原生动画按墙钟线性推进，与视频时钟偏差超阈值时重新对齐
          const expectedElapsed = item.animElapsed + ((now - item.animWall) / 1000) * rate;
          if (Math.abs(expectedElapsed - (t - comment.time)) > nativeDriftToleranceSec) {
            const progress = danmakuScrollProgress(comment.time, t, duration);
            item.translateX.setValue(scrollTranslateX(width, item.width, progress));
            startScrollTiming(item, progress * duration, rate, now);
          }
        } else if (comment.mode !== 0) {
          // 不透明度在驻停期为常数，仅在淡入淡出窗口写入，避免每帧重复桥接
          const nextOpacity = fixedDanmakuOpacity(comment.time, t, duration, opacityRef.current);
          if (nextOpacity !== item.lastOpacity) {
            item.lastOpacity = nextOpacity;
            item.opacityValue.setValue(nextOpacity);
          }
        }
        next.push(item);
        if (created && comment.mode === 0 && playing) {
          const progress = danmakuScrollProgress(comment.time, t, duration);
          startScrollTiming(item, progress * duration, rate, now);
        }
      }

      const changed =
        rebuilt ||
        next.length !== prev.length ||
        next.some((item, index) => item !== prev[index]);
      liveRef.current = next;
      if (changed) setLive(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      for (const item of liveRef.current) {
        item.anim?.stop();
        item.anim = null;
      }
      liveRef.current = [];
      tracksRef.current = [];
    };
  }, [enabled, visibleComments, area, density]);

  if (!enabled || comments.length === 0) return null;

  const displayFontSize = Platform.isTV ? fontSize + 6 : fontSize;

  return (
    <View pointerEvents="none" style={styles.stage}>
      {live.map((item) => (
        <Animated.View
          key={item.key}
          pointerEvents="none"
          collapsable={false}
          style={[
            styles.itemWrap,
            {
              top: item.y,
              left: item.mode === 0 ? 0 : (screenWidth - item.width) / 2,
              opacity: item.mode === 0 ? 1 : item.opacityValue,
              transform: item.mode === 0 ? [{ translateX: item.translateX }] : [],
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.item,
              {
                color: item.color,
                fontSize: displayFontSize,
                opacity: item.mode === 0 ? opacity : 1,
              },
            ]}
          >
            {item.text}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  stage: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 8,
    overflow: "hidden",
  },
  itemWrap: {
    position: "absolute",
    left: 0,
  },
  item: {
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    includeFontPadding: false,
  },
});
