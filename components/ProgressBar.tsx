import React, { useRef } from "react";
import { View, StyleSheet, Platform, ViewStyle, LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import usePlayerStore from "@/stores/playerStore";
import { ratioFromBarTouch } from "@/utils/seekUtils";

interface ProgressBarProps {
  style?: ViewStyle;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ style }) => {
  const { isSeeking, seekPosition, progressPosition, bufferedPosition, startScrub, updateScrub, commitScrub, status } =
    usePlayerStore();
  const barWidth = useRef(0);
  const ratio = isSeeking ? seekPosition : progressPosition;
  const canScrub = !Platform.isTV && (status.durationMillis || 0) > 0;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) {
      barWidth.current = width;
    }
  };

  const ratioFromX = (x: number) => ratioFromBarTouch(x, 0, barWidth.current);

  const pan = Gesture.Pan()
    .enabled(canScrub)
    .minDistance(0)
    .hitSlop(12)
    .runOnJS(true)
    .onBegin((event) => {
      if (barWidth.current <= 0) return;
      startScrub(ratioFromX(event.x));
    })
    .onUpdate((event) => {
      if (barWidth.current <= 0) return;
      updateScrub(ratioFromX(event.x));
    })
    .onFinalize(() => {
      if (!usePlayerStore.getState().isSeeking) return;
      if (barWidth.current <= 0) return;
      // 松手事件的 x 可能是 NaN，clampRatio 会把它变成片头。拖动位置以 onUpdate 写入的 seekPosition 为准。
      commitScrub();
    });

  const compact = !Platform.isTV;
  const track = (
    <View collapsable={false} onLayout={onLayout} style={[compact ? styles.containerCompact : styles.container, style]}>
      <View style={compact ? styles.trackCompact : styles.track} pointerEvents="none">
        <View style={compact ? styles.backgroundCompact : styles.background} />
        <View
          style={[
            compact ? styles.bufferedCompact : styles.buffered,
            { width: `${bufferedPosition * 100}%` },
          ]}
        />
        <View
          style={[
            compact ? styles.filledCompact : styles.filled,
            { width: `${ratio * 100}%` },
          ]}
        />
        {compact && (
          <View
            style={[
              styles.thumb,
              isSeeking ? styles.thumbActive : null,
              { left: `${ratio * 100}%` },
            ]}
          />
        )}
      </View>
    </View>
  );

  if (Platform.isTV) {
    return track;
  }

  return (
    <View style={styles.gestureWrap}>
      <GestureDetector gesture={pan}>{track}</GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: 32,
    justifyContent: "center",
    marginTop: 10,
    zIndex: 20,
  },
  gestureWrap: {
    flex: 1,
  },
  containerCompact: {
    width: "100%",
    height: 22,
    justifyContent: "center",
    zIndex: 20,
  },
  track: {
    width: "100%",
    height: 8,
    position: "relative",
    justifyContent: "center",
    overflow: "visible",
  },
  trackCompact: {
    width: "100%",
    height: 3,
    position: "relative",
    justifyContent: "center",
    overflow: "visible",
  },
  background: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 8,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 4,
  },
  backgroundCompact: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2,
  },
  buffered: {
    position: "absolute",
    zIndex: 1,
    left: 0,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 4,
  },
  bufferedCompact: {
    position: "absolute",
    zIndex: 1,
    left: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 2,
  },
  filled: {
    position: "absolute",
    zIndex: 2,
    left: 0,
    height: 8,
    backgroundColor: "#00bb5e",
    borderRadius: 4,
  },
  filledCompact: {
    position: "absolute",
    zIndex: 2,
    left: 0,
    height: 3,
    backgroundColor: "#00bb5e",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    zIndex: 3,
    top: -3.5,
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    backgroundColor: "#ffffff",
  },
  thumbActive: {
    top: -4.5,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
});
