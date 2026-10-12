/**
 * Add Scene Bottom Sheet Modal (design stitch_scene_design/_2).
 *
 * Provides a refined bottom drawer for quick context creation with:
 *   - Drag indicator handle
 *   - "添加新场景" title with "情境聚焦" badge
 *   - Name input with quick clear button
 *   - Preset recommendations (☕️ 咖啡馆, 🚇 通勤中, 🏃 健身房, 🛏️ 卧室, 🌲 户外, 💻 办公桌, 📱 随时)
 *   - "取消" and "保存并激活" action buttons
 */
import { memo, useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { cn } from '@nextdo/ui';
import { useAppInsets } from '@/lib/use-app-insets';

export interface AddSceneModalProps {
  visible: boolean;
  onClose: () => void;
  onSaveAndActivate: (name: string) => Promise<void> | void;
}

const PRESET_SCENES = [
  { emoji: '☕️', name: '咖啡馆' },
  { emoji: '🚇', name: '通勤中' },
  { emoji: '🏃', name: '健身房' },
  { emoji: '🛏️', name: '卧室' },
  { emoji: '🌲', name: '户外' },
  { emoji: '💻', name: '办公桌' },
  { emoji: '📱', name: '随时' },
];

export const AddSceneModal = memo(function AddSceneModal({
  visible,
  onClose,
  onSaveAndActivate,
}: AddSceneModalProps) {
  const [sceneName, setSceneName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSelectPreset = useCallback((preset: { emoji: string; name: string }) => {
    const combined = `${preset.name} ${preset.emoji}`;
    setSceneName(combined);
    setSelectedPreset(preset.name);
  }, []);

  const handleClear = useCallback(() => {
    setSceneName('');
    setSelectedPreset(null);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = sceneName.trim();
    if (trimmed === '' || saving) return;
    setSaving(true);
    try {
      await onSaveAndActivate(trimmed);
      setSceneName('');
      setSelectedPreset(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [sceneName, saving, onSaveAndActivate, onClose]);

  const handleClose = useCallback(() => {
    setSceneName('');
    setSelectedPreset(null);
    onClose();
  }, [onClose]);

  const insets = useAppInsets();
  const bottomPadding = Math.max(insets.bottom, 12);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View className="flex-1 justify-end bg-black/40 md:items-center md:justify-center md:p-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭弹窗"
          onPress={handleClose}
          className="flex-1"
        />

        <View
          style={{ paddingBottom: bottomPadding }}
          className="w-full rounded-t-3xl border-t border-border/80 bg-surface p-5 pt-3 shadow-2xl dark:border-border-dark dark:bg-surface-dark md:max-w-md md:rounded-2xl md:border md:p-6"
        >
          {/* Top drag handle indicator (mobile only) */}
          <View className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-border dark:bg-border-dark md:hidden" />

          {/* Modal Header */}
          <View className="mb-4 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="font-display text-base font-bold tracking-tight text-ink dark:text-ink-dark">
                添加新场景
              </Text>
              <View className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 dark:border-accent-dark/40 dark:bg-accent-dark/20">
                <Text className="font-sans text-[11px] font-medium text-accent dark:text-accent-dark">
                  情境聚焦
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={handleClose}
              className="h-7 w-7 items-center justify-center rounded-full bg-surface-container active:scale-95 dark:bg-surface-container-dark"
            >
              <Ionicons name="close" size={16} color="#716b64" />
            </Pressable>
          </View>

          {/* Form Content */}
          <View className="gap-4">
            {/* Field 1: Scene Name Input */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                场景名称
              </Text>
              <View className="relative flex-row items-center">
                <TextInput
                  accessibilityLabel="场景名称输入框"
                  placeholder="输入场景名称，如：咖啡馆、通勤中…"
                  value={sceneName}
                  onChangeText={(val) => {
                    setSceneName(val);
                    setSelectedPreset(null);
                  }}
                  autoFocus
                  className="h-11 flex-1 rounded-xl border-2 border-accent bg-accent/5 px-3.5 pr-9 font-sans text-sm font-medium text-ink placeholder:text-muted dark:border-accent-dark dark:bg-accent-dark/10 dark:text-ink-dark dark:placeholder:text-muted-dark"
                  style={{
                    paddingVertical: Platform.OS === 'android' ? 0 : 8,
                    textAlignVertical: 'center',
                  }}
                  onSubmitEditing={handleSave}
                />
                {sceneName.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清空场景名称"
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    onPress={handleClear}
                    className="absolute right-2.5 h-6 w-6 items-center justify-center rounded-full active:opacity-70"
                  >
                    <Ionicons name="close-circle" size={16} color="#9b948a" />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Field 2: Preset Recommendations */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                快速选择预设推荐
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {PRESET_SCENES.map((preset) => {
                  const isSelected = selectedPreset === preset.name;
                  return (
                    <Pressable
                      key={preset.name}
                      accessibilityRole="button"
                      accessibilityLabel={`预设推荐：${preset.name}`}
                      onPress={() => handleSelectPreset(preset)}
                      className={cn(
                        'flex-row items-center gap-1 rounded-full px-3 py-1.5 active:scale-95',
                        isSelected
                          ? 'border border-accent bg-accent shadow-xs dark:border-accent-dark dark:bg-accent-dark'
                          : 'border border-border/80 bg-surface active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark',
                      )}
                    >
                      <Text className="text-xs">{preset.emoji}</Text>
                      <Text
                        className={cn(
                          'font-sans text-xs font-medium',
                          isSelected
                            ? 'font-semibold text-on-accent dark:text-on-accent-dark'
                            : 'text-ink dark:text-ink-dark',
                        )}
                      >
                        {preset.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Modal Actions */}
            <View className="flex-row gap-3 pt-2 pb-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消"
                onPress={handleClose}
                className="h-10 flex-1 items-center justify-center rounded-full bg-surface-container active:scale-95 dark:bg-surface-container-dark"
              >
                <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                  取消
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="保存并激活"
                onPress={handleSave}
                disabled={sceneName.trim() === '' || saving}
                className={cn(
                  'h-10 flex-[2] flex-row items-center justify-center gap-1.5 rounded-full bg-accent active:scale-95 dark:bg-accent-dark',
                  (sceneName.trim() === '' || saving) && 'opacity-50',
                )}
              >
                <Ionicons name="checkmark" size={16} color="#ffffff" />
                <Text className="font-sans text-xs font-semibold text-on-accent dark:text-on-accent-dark">
                  保存并激活
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
});
