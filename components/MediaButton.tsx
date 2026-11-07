import React, { ComponentProps } from "react";
import { StyledButton } from "./StyledButton";
import { StyleSheet, View, Text, Pressable, Platform } from "react-native";

type StyledButtonProps = ComponentProps<typeof StyledButton> & {
  timeLabel?: string;
};

export const MediaButton = ({ timeLabel, children, ...props }: StyledButtonProps) => {
  if (!Platform.isTV) {
    return (
      <Pressable
        onPress={props.onPress}
        disabled={props.disabled}
        hitSlop={8}
        style={[styles.compactButton, props.disabled ? styles.compactDisabled : null]}
      >
        {children}
        {timeLabel ? <Text style={styles.compactTimeLabel}>{timeLabel}</Text> : null}
      </Pressable>
    );
  }

  return (
    <View>
      <StyledButton {...props} style={[styles.mediaControlButton, props.style]} variant="ghost">
        {children}
      </StyledButton>
      {timeLabel && <Text style={styles.timeLabel}>{timeLabel}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  mediaControlButton: {
    padding: 12,
    minWidth: 80,
  },
  timeLabel: {
    position: "absolute",
    top: 14,
    right: 12,
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  compactButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  compactDisabled: {
    opacity: 0.4,
  },
  compactTimeLabel: {
    position: "absolute",
    top: 1,
    right: -2,
    color: "white",
    fontSize: 8,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: "hidden",
  },
});
