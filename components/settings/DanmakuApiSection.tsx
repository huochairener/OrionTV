import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { View, TextInput, StyleSheet, Animated, Platform, useTVEventHandler, type HWEvent } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import Toast from "react-native-toast-message";

interface DanmakuApiSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
  hideDescription?: boolean;
}

export interface DanmakuApiSectionRef {
  setInputValue: (value: string) => void;
}

export const DanmakuApiSection = forwardRef<DanmakuApiSectionRef, DanmakuApiSectionProps>(
  ({ onChanged, onFocus, onBlur, onPress, hideDescription = false }, ref) => {
    const {
      danmakuApiUrl,
      setDanmakuApiUrl,
      fetchDanmakuApiConfig,
      isFetchingDanmakuApi,
      remoteInputEnabled,
    } = useSettingsStore();
    const { serverUrl } = useRemoteControlStore();
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isSectionFocused, setIsSectionFocused] = useState(false);
    const inputRef = useRef<TextInput>(null);
    const inputAnimationStyle = useButtonAnimation(isSectionFocused, 1.01);
    const deviceType = useResponsiveLayout().deviceType;

    const handleUrlChange = (url: string) => {
      setDanmakuApiUrl(url);
      onChanged();
    };

    useImperativeHandle(ref, () => ({
      setInputValue: (value: string) => {
        setDanmakuApiUrl(value);
        onChanged();
      },
    }));

    const handleSectionFocus = () => {
      setIsSectionFocused(true);
      onFocus?.();
    };

    const handleSectionBlur = () => {
      setIsSectionFocused(false);
      onBlur?.();
    };

    const handlePress = () => {
      inputRef.current?.focus();
      onPress?.();
    };

    const handlePull = async () => {
      const url = await fetchDanmakuApiConfig();
      if (url) {
        onChanged();
        Toast.show({
          type: "success",
          text1: "已拉取到服务端弹幕API配置",
        });
        return;
      }
      Toast.show({
        type: "info",
        text1: "未拉取到服务端配置的弹幕api信息",
      });
    };

    const handleTVEvent = React.useCallback(
      (event: HWEvent) => {
        if (!Platform.isTV || !isSectionFocused || event.eventType !== "select") return;
        inputRef.current?.focus();
      },
      [isSectionFocused]
    );

    useTVEventHandler(handleTVEvent);

    const [selection, setSelection] = useState<{ start: number; end: number }>({
      start: 0,
      end: 0,
    });
    const onSelectionChange = ({
      nativeEvent: { selection },
    }: any) => {
      setSelection(selection);
    };

    return (
      <SettingsSection
        focusable
        onFocus={handleSectionFocus}
        onBlur={handleSectionBlur}
        {...(Platform.isTV || deviceType !== "tv" ? undefined : { onPress: handlePress })}
      >
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>弹幕API</ThemedText>
            {!hideDescription && remoteInputEnabled && serverUrl && (
              <ThemedText style={styles.subtitle}>用手机访问 {serverUrl}，可远程输入</ThemedText>
            )}
            <StyledButton
              text={isFetchingDanmakuApi ? "拉取中..." : "拉取"}
              onPress={handlePull}
              disabled={isFetchingDanmakuApi}
              variant="default"
              style={styles.pullButton}
              textStyle={styles.pullButtonText}
            />
          </View>
          <Animated.View style={inputAnimationStyle}>
            <TextInput
              ref={inputRef}
              style={[styles.input, isInputFocused && styles.inputFocused]}
              value={danmakuApiUrl}
              onChangeText={handleUrlChange}
              placeholder="输入弹幕API地址，或点击拉取从服务端获取"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => {
                setIsInputFocused(true);
                const end = danmakuApiUrl.length;
                setSelection({ start: end, end: end });
                setTimeout(() => {
                  inputRef.current?.setNativeProps({ selection: { start: end, end: end } });
                }, 0);
              }}
              selection={selection}
              onSelectionChange={onSelectionChange}
              onBlur={() => setIsInputFocused(false)}
            />
          </Animated.View>
        </View>
      </SettingsSection>
    );
  }
);

DanmakuApiSection.displayName = "DanmakuApiSection";

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 12,
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
    flexShrink: 1,
    marginRight: 8,
  },
  pullButton: {
    marginLeft: "auto",
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pullButtonText: {
    fontSize: 14,
  },
  inputContainer: {
    marginBottom: 12,
  },
  input: {
    height: 50,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: "#3a3a3c",
    color: "white",
    borderColor: "transparent",
  },
  inputFocused: {
    borderColor: Colors.dark.primary,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
});
