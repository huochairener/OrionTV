import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Keyboard, ActivityIndicator } from "react-native";
import Modal from "react-native-modal";
import { StyledButton } from "./StyledButton";
import useDanmakuStore from "@/stores/danmakuStore";
import { formatDanmakuSourceLabel } from "@/utils/danmaku";

export const DanmakuSourceModal: React.FC = () => {
  const {
    showModal,
    setShowModal,
    sources,
    episodes,
    selectedAnime,
    selection,
    searchKeyword,
    setSearchKeyword,
    search,
    selectAnime,
    selectEpisode,
    loading,
    probing,
    searchError,
    enabled,
    toggleEnabled,
    count,
    area,
    density,
    setArea,
    setDensity,
  } = useDanmakuStore();
  const [focusFirstSource, setFocusFirstSource] = useState(false);

  const onClose = () => setShowModal(false);

  const runSearch = () => {
    Keyboard.dismiss();
    setFocusFirstSource(false);
    void search(undefined, { fromUser: true }).then(() => {
      const next = useDanmakuStore.getState();
      if (next.sources.length > 0 && !next.selectedAnime) {
        setFocusFirstSource(true);
      }
    });
  };

  return (
    <Modal
      isVisible={showModal}
      statusBarTranslucent={true}
      onBackButtonPress={onClose}
      onBackdropPress={onClose}
      onSwipeComplete={onClose}
      swipeDirection="down"
      propagateSwipe
      avoidKeyboard
      style={styles.modalContainer}
    >
      <View style={styles.modalContent}>
        <Text style={styles.modalTitle}>弹幕源</Text>
        <View style={styles.toolbar}>
          <StyledButton
            text={enabled ? "弹幕开" : "弹幕关"}
            isSelected={enabled}
            onPress={toggleEnabled}
            style={styles.toggle}
            textStyle={styles.toggleText}
          />
          {count > 0 ? <Text style={styles.count}>{count} 条</Text> : null}
        </View>
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>显示区域</Text>
          <View style={styles.settingRow}>
            {([
              { value: 0.25, label: "25%" },
              { value: 0.5, label: "50%" },
              { value: 0.75, label: "75%" },
            ] as const).map((item) => (
              <StyledButton
                key={item.label}
                text={item.label}
                isSelected={area === item.value}
                hasTVPreferredFocus={area === item.value}
                onPress={() => setArea(item.value)}
                style={styles.settingBtn}
                textStyle={styles.settingBtnText}
              />
            ))}
          </View>
        </View>
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>密度</Text>
          <View style={styles.settingRow}>
            {([
              { value: "sparse", label: "稀疏" },
              { value: "medium", label: "中等" },
              { value: "unlimited", label: "无限" },
            ] as const).map((item) => (
              <StyledButton
                key={item.value}
                text={item.label}
                isSelected={density === item.value}
                onPress={() => setDensity(item.value)}
                style={styles.settingBtn}
                textStyle={styles.settingBtnText}
              />
            ))}
          </View>
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={searchKeyword}
            onChangeText={setSearchKeyword}
            placeholder="搜索弹幕源"
            placeholderTextColor="#888"
            style={styles.input}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          <StyledButton
            text={loading && !selectedAnime ? "搜索中" : "搜索"}
            onPress={runSearch}
            isLoading={loading && !selectedAnime}
            disabled={loading}
            style={styles.searchBtn}
            textStyle={styles.searchBtnText}
          />
        </View>
        {loading ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="#00bb5e" />
            <Text style={styles.hint}>
              {selectedAnime ? "正在加载分集..." : `正在搜索「${searchKeyword}」的弹幕源...`}
            </Text>
          </View>
        ) : null}
        {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
        {!loading && !searchError && !selectedAnime && sources.length === 0 ? (
          <Text style={styles.hint}>暂无弹幕源，输入关键词后点击搜索</Text>
        ) : null}

        <View style={styles.listPane}>
          {!loading && !selectedAnime && sources.length > 0 ? (
            <Text style={styles.hint}>
              {probing
                ? `找到 ${sources.length} 个弹幕源，正在统计各源弹幕数...`
                : `找到 ${sources.length} 个弹幕源，请选择`}
            </Text>
          ) : null}
          {selectedAnime ? (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <Pressable
                onPress={() => {
                  setFocusFirstSource(true);
                  useDanmakuStore.setState({ selectedAnime: null, episodes: [] });
                }}
              >
                <Text style={styles.back}>‹ 返回源列表 · {selectedAnime.animeTitle}</Text>
              </Pressable>
              <View style={styles.episodeWrap} onStartShouldSetResponder={() => true}>
                {episodes.map((item) => (
                  <StyledButton
                    key={`ep-${item.episodeId}`}
                    text={item.episodeTitle}
                    onPress={() => selectEpisode(item)}
                    isSelected={selection?.episodeId === item.episodeId}
                    style={styles.episodeItem}
                    textStyle={styles.itemText}
                  />
                ))}
              </View>
            </ScrollView>
          ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <View onStartShouldSetResponder={() => true}>
                {sources.map((item, index) => (
                  <StyledButton
                    key={`anime-${item.animeId}-${item.source}`}
                    text={formatDanmakuSourceLabel(item)}
                    onPress={() => {
                      setFocusFirstSource(false);
                      void selectAnime(item, index);
                    }}
                    isSelected={selection?.animeId === item.animeId}
                    hasTVPreferredFocus={focusFirstSource && index === 0}
                    style={styles.item}
                    textStyle={styles.itemText}
                  />
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    margin: 0,
    alignItems: "flex-end",
  },
  modalContent: {
    width: "82%",
    height: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    padding: 16,
  },
  listPane: {
    flex: 1,
    minHeight: 96,
  },
  list: {
    flex: 1,
  },
  episodeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  episodeItem: {
    paddingVertical: 10,
    margin: 4,
    minWidth: 120,
  },
  modalTitle: {
    color: "white",
    marginBottom: 8,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 10,
  },
  toggle: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 72,
  },
  toggleText: {
    fontSize: 14,
  },
  count: {
    color: "#9adbb5",
    fontSize: 13,
  },
  settingBlock: {
    marginBottom: 8,
  },
  settingLabel: {
    color: "#9adbb5",
    fontSize: 13,
    marginBottom: 6,
  },
  settingRow: {
    flexDirection: "row",
    gap: 8,
  },
  settingBtn: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
    minWidth: 0,
  },
  settingBtnText: {
    fontSize: 14,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "white",
  },
  searchBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  searchBtnText: {
    fontSize: 14,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  hint: {
    color: "#9adbb5",
    marginBottom: 8,
    fontSize: 13,
  },
  error: {
    color: "#ff8a8a",
    marginBottom: 8,
  },
  back: {
    color: "#00bb5e",
    marginBottom: 8,
    fontSize: 14,
  },
  item: {
    paddingVertical: 10,
    margin: 4,
  },
  itemText: {
    fontSize: 14,
    textAlign: "left",
  },
});
