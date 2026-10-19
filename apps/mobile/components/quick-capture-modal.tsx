/**
 * QuickCaptureModal (design.md §4.2):
 *
 * Lightweight iOS-style quick capture modal triggered on app launch
 * or via quick capture actions. Auto-focuses text input and saves on
 * Enter or [记录]. Each successful save hands the new InboxItem to
 * `onCaptured` (the parent closes the modal and opens the Clarify wizard
 * for it — PRD R1: 记一条问一条, which replaces the old multi-capture
 * session). Dismisses on mask tap / ESC / 稍后再说.
 */
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, colors } from '@nextdo/ui';
import { errorMessage } from '@/lib/error-messages';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';
import type { InboxItem } from '@nextdo/core';

export interface QuickCaptureModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (title: string) => Promise<InboxItem | null>;
  /** Capture-and-continue (PRD R1): called with the saved item — the
   *  parent closes the modal and opens the Clarify wizard for it. */
  onCaptured?: (item: InboxItem) => void;
  error?: unknown;
}

export function QuickCaptureModal({
  visible,
  onClose,
  onAdd,
  onCaptured,
  error,
}: QuickCaptureModalProps) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const { isDark } = useAppTheme();
  const insets = useAppInsets();
  const bottomPadding = Math.max(insets.bottom, 16);

  const handleCapture = async () => {
    const title = draft.trim();
    if (title === '' || saving) return;
    setSaving(true);
    try {
      const item = await onAdd(title);
      if (item !== null) {
        // R1 handoff: reset the draft and let the parent take the item to
        // the Clarify wizard (记一条问一条).
        setDraft('');
        onCaptured?.(item);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setDraft('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ pointerEvents: 'auto' }}
        className="flex-1 justify-end bg-black/30 dark:bg-black/50 md:items-center md:justify-center md:px-4"
      >
        {/* Backdrop dismiss */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭弹窗"
          className="absolute inset-0"
          onPress={handleClose}
        />

        {/* Modal Card: Bottom sheet on mobile (ergonomic thumb zone), compact centered dialog on desktop */}
        <View
          style={{ paddingBottom: bottomPadding }}
          className="relative z-10 w-full rounded-t-3xl border-t border-border/80 bg-surface p-5 pt-3 shadow-2xl dark:border-border-dark dark:bg-surface-dark md:max-w-md md:rounded-2xl md:border md:p-6"
        >
          {/* Mobile top drag handle indicator */}
          <View className="mx-auto mb-3.5 h-1.5 w-12 rounded-full bg-border/80 dark:bg-border-dark md:hidden" />

          <View className="mb-3.5 flex-row items-center justify-between">
            <View>
              <Text className="font-display text-lg font-bold tracking-tight text-ink dark:text-ink-dark md:text-xl">
                有什么想记下的？
              </Text>
              <Text className="mt-0.5 font-sans text-xs text-muted dark:text-muted-dark">
                清空大脑：记录想法、待办或灵感
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭速记弹窗"
              onPress={handleClose}
              className="h-7 w-7 items-center justify-center rounded-full bg-surface-container/60 active:scale-95 dark:bg-surface-container-dark/60"
            >
              <Ionicons name="close" size={16} color={isDark ? colors.mutedDark : colors.muted} />
            </Pressable>
          </View>

          <TextInput
            autoFocus
            multiline
            className="mb-3.5 min-h-[88px] rounded-xl border border-border/80 bg-canvas p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-canvas-dark dark:text-ink-dark dark:placeholder:text-muted-dark md:min-h-[96px] md:rounded-2xl md:p-3.5"
            placeholder="记下任何事…（Enter 快速保存）"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void handleCapture()}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Escape') {
                handleClose();
                return;
              }
              const isShift = 'shiftKey' in e.nativeEvent && Boolean(e.nativeEvent.shiftKey);
              if (e.nativeEvent.key === 'Enter' && !isShift) {
                void handleCapture();
              }
            }}
            blurOnSubmit={false}
          />

          {error ? (
            <Text className="mb-3 text-xs text-danger">
              {errorMessage(error)}
            </Text>
          ) : null}

          <View className="flex-row items-center justify-end gap-2.5">
            <Button
              label="稍后再说"
              variant="ghost"
              size="sm"
              onPress={handleClose}
            />
            <Button
              label={saving ? '记录中…' : '记录'}
              variant="primary"
              size="sm"
              disabled={draft.trim() === '' || saving}
              onPress={() => void handleCapture()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
