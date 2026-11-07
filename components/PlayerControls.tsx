import React from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Pause, Play, SkipForward, List, Tv, ArrowDownToDot, ArrowUpFromDot, Gauge, Unlock, Lock, ChevronLeft, Rocket, MessageCircle } from "lucide-react-native";
import { ThemedText } from "@/components/ThemedText";
import { MediaButton } from "@/components/MediaButton";
import { FontAwesome } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";
import { useSources } from "@/stores/sourceStore";
import { useSettingsStore } from "@/stores/settingsStore";

import {Battery} from '@brightlayer-ui/react-native-progress-icons';
import { useBatteryLevel, useBatteryState, BatteryState } from 'expo-battery';
import { format } from 'date-fns';
import { ProgressBar } from "@/components/ProgressBar";
import useDanmakuStore from "@/stores/danmakuStore";

interface PlayerControlsProps {
  showControls: boolean;
  setShowControls: (show: boolean) => void;
  handelBack: () => Promise<void>;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({ showControls, setShowControls, handelBack }) => {
  const { m3u8Proxy } = useSettingsStore.getState();
  const batteryLevel = useBatteryLevel();
  const batteryState = useBatteryState();
  const {
    currentEpisodeIndex,
    episodes,
    status,
    showLockControls,
    toggleLock,
    isSeeking,
    seekPosition,
    playbackRate,
    togglePlayPause,
    playEpisode,
    setShowEpisodeModal,
    setShowSourceModal,
    setShowSpeedModal,
    setIntroEndTime,
    setOutroStartTime,
    toggleFavorite,
    introEndTime,
    outroStartTime,
    isFavorited,
  } = usePlayerStore();

  const { detail } = useDetailStore();
  const resources = useSources();

  const videoTitle = detail?.title || "";
  const currentEpisode = episodes[currentEpisodeIndex];
  const currentEpisodeTitle = currentEpisode?.title;
  const currentSource = resources.find((r) => r.source === detail?.source);
  const currentSourceName = currentSource?.source_name || detail?.source_name;
  const hasNextEpisode = currentEpisodeIndex < (episodes.length || 0) - 1;

  const formatTime = (milliseconds: number) => {
    if (!milliseconds) return "00:00";
    const seconds = Math.floor(milliseconds / 1000);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  const onPlayNextEpisode = () => {
    if (hasNextEpisode) {
      playEpisode(currentEpisodeIndex + 1);
    }
  };

  const durationMillis = status.durationMillis || 0;
  const seekPositionMillis = seekPosition * durationMillis;
  const { openModal: openDanmakuModal, enabled: danmakuEnabled, count: danmakuCount } = useDanmakuStore();
  const compact = !Platform.isTV;
  const iconSize = compact ? 18 : 24;
  const playIconSize = compact ? 20 : 24;
  const currentTimeLabel = status?.isLoaded
    ? formatTime(isSeeking ? seekPositionMillis : status.positionMillis)
    : "00:00";
  const durationLabel = status?.isLoaded ? formatTime(status.durationMillis || 0) : "00:00";
  const titleText = `${videoTitle}${episodes.length > 1 && currentEpisodeTitle ? ` - ${currentEpisodeTitle}` : ""}${
    currentSourceName ? ` (${currentSourceName})` : ""
  }`;

  const actionButtons = (
    <View style={compact ? styles.bottomControlsCompact : styles.bottomControls}>
      {episodes.length > 1 && (
        <MediaButton onPress={setIntroEndTime} timeLabel={introEndTime ? formatTime(introEndTime) : undefined}>
          <ArrowDownToDot color="white" size={iconSize} />
        </MediaButton>
      )}

      <MediaButton onPress={togglePlayPause} hasTVPreferredFocus={showControls}>
        {status?.isLoaded && status.isPlaying ? (
          <Pause color="white" size={playIconSize} />
        ) : (
          <Play color="white" size={playIconSize} />
        )}
      </MediaButton>

      {episodes.length > 1 && (
        <MediaButton onPress={onPlayNextEpisode} disabled={!hasNextEpisode}>
          <SkipForward color={hasNextEpisode ? "white" : "#666"} size={iconSize} />
        </MediaButton>
      )}

      {episodes.length > 1 && (
        <MediaButton onPress={setOutroStartTime} timeLabel={outroStartTime ? formatTime(outroStartTime) : undefined}>
          <ArrowUpFromDot color="white" size={iconSize} />
        </MediaButton>
      )}

      {episodes.length > 1 && (
        <MediaButton onPress={() => setShowEpisodeModal(true)}>
          <List color="white" size={iconSize} />
        </MediaButton>
      )}

      <MediaButton onPress={() => setShowSourceModal(true)}>
        <Tv color="white" size={iconSize} />
      </MediaButton>

      <MediaButton onPress={() => setShowSpeedModal(true)} timeLabel={playbackRate !== 1.0 ? `${playbackRate}x` : undefined}>
        <Gauge color="white" size={iconSize} />
      </MediaButton>

      <MediaButton onPress={openDanmakuModal} timeLabel={danmakuCount > 0 ? `${danmakuCount}` : undefined}>
        <MessageCircle color={danmakuEnabled ? "#00bb5e" : "white"} size={iconSize} />
      </MediaButton>

      <MediaButton onPress={toggleFavorite}>
        <FontAwesome
          name={isFavorited ? "heart" : "heart-o"}
          size={compact ? 16 : 20}
          color={isFavorited ? "#feff5f" : "#ccc"}
        />
      </MediaButton>
    </View>
  );

  return (
    <View style={styles.controlContainer} pointerEvents="box-none">
      {!showLockControls && (
        <LinearGradient
          colors={["rgba(0,0,0,0.72)", "transparent"]}
          style={compact ? styles.topBarCompact : styles.topBar}
          pointerEvents="box-none"
        >
          <View style={styles.topRow} pointerEvents="box-none">
            {compact && (
              <Pressable onPress={handelBack} style={styles.topBackButton} hitSlop={8}>
                <ChevronLeft color="white" size={22} />
              </Pressable>
            )}
            <Text style={compact ? styles.topTitleTextCompact : styles.topTitleText} numberOfLines={1} ellipsizeMode="tail">
              {titleText}
            </Text>
            {/^http/.test(m3u8Proxy) && <Rocket color="#00bb5e" size={compact ? 14 : 18} />}
            <Text style={compact ? styles.topTimeTextCompact : styles.topTimeText}>
              {format(new Date(), "HH:mm")}
            </Text>
            {compact && (
              <Battery
                percent={batteryLevel * 100}
                size={20}
                color={"#00bb5ea0"}
                charging={batteryState === BatteryState.CHARGING}
                outlined={false}
              />
            )}
          </View>
        </LinearGradient>
      )}

      {compact && (
        <View style={styles.lockContainer} pointerEvents="box-none">
          <Pressable onPress={toggleLock} style={styles.lockButton} hitSlop={8}>
            {showLockControls ? <Lock color="white" size={16} /> : <Unlock color="white" size={16} />}
          </Pressable>
        </View>
      )}

      {!showLockControls && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.82)"]}
          style={compact ? styles.controlsOverlayCompact : styles.controlsOverlay}
        >
          {compact ? (
            <>
              <View style={styles.progressRow}>
                <Text style={styles.inlineTime}>{currentTimeLabel}</Text>
                <ProgressBar />
                <Text style={styles.inlineTime}>{durationLabel}</Text>
              </View>
              {actionButtons}
            </>
          ) : (
            <View style={styles.bottomControlsContainer}>
              <View style={styles.bottomTimesContainer}>
                <ThemedText style={{ color: "white", marginTop: 5 }}>
                  {currentTimeLabel} / {durationLabel}
                </ThemedText>
              </View>
              <ProgressBar />
              {actionButtons}
            </View>
          )}
        </LinearGradient>
      )}

      {showLockControls && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.65)"]}
          style={styles.lockBottomBarContainer}
        >
          <View style={styles.progressRow}>
            <Text style={styles.inlineTime}>{currentTimeLabel}</Text>
            <ProgressBar />
            <Text style={styles.inlineTime}>{durationLabel}</Text>
          </View>
        </LinearGradient>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  controlContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    pointerEvents: "box-none",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  topBarCompact: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 4,
    paddingHorizontal: 8,
    paddingBottom: 18,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  topTitleText: {
    flex: 1,
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 8,
  },
  topTitleTextCompact: {
    flex: 1,
    color: "white",
    fontSize: 13,
    fontWeight: "600",
    marginHorizontal: 4,
  },
  topBackButton: {
    padding: 2,
    marginRight: 2,
  },
  topTimeText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
    marginRight: 6,
  },
  topTimeTextCompact: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 8,
    marginRight: 6,
  },
  controlsOverlay: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    padding: 20,
  },
  controlsOverlayCompact: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    paddingHorizontal: 10,
    paddingTop: 20,
    paddingBottom: 6,
  },
  bottomControlsContainer: {
    width: "100%",
    alignItems: "center",
  },
  bottomTimesContainer: {
    width: "100%",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  inlineTime: {
    color: "white",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    minWidth: 40,
    textAlign: "center",
  },
  bottomControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 15,
  },
  bottomControlsCompact: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    marginTop: 2,
    width: "100%",
  },
  lockContainer: {
    position: "absolute",
    left: 4,
    top: "50%",
    marginTop: -16,
    zIndex: 999,
  },
  lockButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  lockBottomBarContainer: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    paddingHorizontal: 10,
    paddingTop: 16,
    paddingBottom: 8,
  },
});
