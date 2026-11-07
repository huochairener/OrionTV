import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import Modal from "react-native-modal";
import { StyledButton } from "./StyledButton";
import { ThemedText } from "@/components/ThemedText";
import useDetailStore, { SearchResultWithResolution } from "@/stores/detailStore";
import usePlayerStore, { isSamePlaySource } from "@/stores/playerStore";
import Logger from '@/utils/Logger';
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";

const logger = Logger.withTag('SourceSelectionModal');

const formatSpeed = (speed: number) => {
  if (speed >= 1024) {
    return `${(speed/1024).toFixed(1)} MB/s`;
  }
  return `${speed} KB/s`;
}

export const SourceSelectionModal: React.FC = () => {
  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);
  
  const { showSourceModal, setShowSourceModal, switchSource } = usePlayerStore();
  const { searchResults, detail, allSourcesLoaded } = useDetailStore();

  const onSelectSource = async (item: SearchResultWithResolution) => {
    // 直接使用列表项本身，而不是按 index 回查 searchResults：
    // 测速会异步重排 searchResults，index 回查可能拿到与界面显示不一致的源
    if (!item) return;
    logger.debug("onSelectSource", item.source, item.id, detail?.source, detail?.id);
    if (!isSamePlaySource(detail, item)) {
      await switchSource(item);
      return;
    }
    setShowSourceModal(false);
  };

  const onClose = () => {
    setShowSourceModal(false);
  };

  return (
    <Modal isVisible={showSourceModal} statusBarTranslucent={true} onBackButtonPress={onClose} onBackdropPress={onClose} onSwipeComplete={onClose} swipeDirection="down" style={styles.modalContainer}>
      <View style={styles.modalContent}>
        <View style={styles.modalTitleContainer}>
          {!allSourcesLoaded && (<ActivityIndicator style={{marginRight: 5}} />)}
          <Text style={styles.modalTitle}>换源 ({searchResults.length})</Text>
        </View>
        <FlashList
          data={searchResults}
          numColumns={Math.floor((responsiveConfig.screenWidth * 0.9) / 250)}
          // keyExtractor={(item, index) => `source-${item.id}-${index}`}
          extraData={`${detail?.source}-${detail?.id}`}
          estimatedItemSize={60}
          renderItem={({ item }) => {
            const isSelected = isSamePlaySource(detail, item);
            return (
              <StyledButton
                onPress={() => onSelectSource(item)}
                isSelected={isSelected}
                hasTVPreferredFocus={isSelected}
                style={styles.sourceItem}
                textStyle={dynamicStyles.sourceButton}
              >
                  <ThemedText style={dynamicStyles.sourceButtonText}>{item.source_name}</ThemedText>
                  {item.episodes.length > 1 && (
                    <View style={[dynamicStyles.badge, isSelected && dynamicStyles.selectedBadge]}>
                      <Text style={dynamicStyles.badgeText}>
                        {`${item.episodes.length}`} 集
                      </Text>
                    </View>
                  )}
                  {item.speed > 0 && (
                    <View style={[dynamicStyles.badge, isSelected && dynamicStyles.selectedBadge]}>
                      <Text style={dynamicStyles.badgeText}>
                        {formatSpeed(item.speed)}
                      </Text>
                    </View>
                  )}
              </StyledButton>
            );
          }}
        />
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
    width: '90%',
    height: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    padding: 20,
  },
  modalTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    color: "white",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
  sourceItem: {
    flex: 1,
    paddingVertical: 2,
    margin: 4,
    marginLeft: 10,
    marginRight: 8,
  },
  sourceItemText: {
    fontSize: 14,
  },
});

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isTV = deviceType === 'tv';
  const isTablet = deviceType === 'tablet';
  const isMobile = deviceType === 'mobile';

  return StyleSheet.create({
    sourceButton: {
      margin: isMobile ? 4 : 8,
      minHeight: isMobile ? 36 : 44,
    },
    sourceButtonText: {
      color: "white",
      fontSize: isMobile ? 14 : 16,
    },
    badge: {
      backgroundColor: "#666",
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginLeft: 8,
    },
    badgeText: {
      color: "#fff",
      fontSize: isMobile ? 10 : 12,
      fontWeight: "bold",
      paddingBottom: 2.5,
    },
    selectedBadge: {
      backgroundColor: "#4c4c4c",
    },
  });
};
