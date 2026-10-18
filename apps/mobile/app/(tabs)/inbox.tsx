/**
 * The Inbox tab (design §2 — Paper Serenity rework): low-friction capture +
 * list. "清空大脑" — the buffer, not a to-do list.
 *
 * - capture: one TextInput in the capture card, Enter or [记录并澄清] saves
 *   immediately (no classification, no required fields);
 * - quick capture modal: automatically displayed on launch for zero-friction
 *   thought dump (skin only — behavior untouched);
 * - R1 handoff: EVERY capture path (modal + inline card) funnels through
 *   `handoffToClarify` — the modal closes and the Clarify wizard opens for
 *   the new item immediately (记一条问一条); "再记一条" from the wizard
 *   returns here via the one-shot `recapture=1` route param;
 * - list: oldest first; a row's title opens the Clarify wizard (R3) and the
 *   row's 处理 → button does the same; the trash button confirms inline
 *   (one tap to arm, one tap to delete);
 * - rows older than 24h carry the warning-colored 优先澄清 meta (the text
 *   itself is the signal — color is never the only one, component-
 *   guidelines);
 * - a static "GTD 澄清心法" card closes the screen.
 *
 * Presentational only: data arrives from `useInboxItems`, mutations go
 * through the mutation hooks (component-guidelines). All row time math runs
 * against the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, EmptyState, Tag, colors } from '@nextdo/ui';
import { useInboxItems } from '@/hooks/use-inbox-items';
import { useAddInboxItem } from '@/hooks/use-add-inbox-item';
import { useTrashInboxItem } from '@/hooks/use-trash-inbox-item';
import { useWaitingForItems } from '@/hooks/use-waiting-for';
import { useAppClock } from '@/hooks/use-app-clock';
import { formatRelativeTime } from '@/lib/format';
import { errorMessage } from '@/lib/error-messages';
import { QuickCaptureModal } from '@/components/quick-capture-modal';
import { useAppTheme } from '@/lib/theme';
import type { InboxItem } from '@nextdo/core';

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** Captures older than this get the warning "优先澄清" meta (design §2). */
const PRIORITY_AFTER_MS = 24 * 60 * 60 * 1000;

/** One inbox row: tap the title → clarify; 处理 → does the same; trash
 *  arms, then confirms. */
function InboxRow({
  item,
  now,
  onTrash,
}: {
  item: InboxItem;
  now: Date;
  onTrash: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const needsPriority =
    now.getTime() - new Date(item.capturedAt).getTime() > PRIORITY_AFTER_MS;

  return (
    <Card variant="outlined" className="gap-2.5 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      <View className="flex-row items-center gap-3">
        <Pressable
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel={`明晰：${item.title}`}
          onPress={() => router.push(`/clarify/${item.id}`)}
        >
          <Text className="font-sans text-base font-medium leading-snug text-ink dark:text-ink-dark">
            {item.title}
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              {formatRelativeTime(item.capturedAt, now)}
            </Text>
            {needsPriority ? (
              <Text className="font-sans text-xs font-semibold text-warning dark:text-warning-dark">
                · 优先澄清
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Button
          size="sm"
          label="处理 →"
          variant="tinted"
          onPress={() => router.push(`/clarify/${item.id}`)}
        />
        {armed ? (
          <Button
            size="sm"
            label="确认删除？"
            variant="secondary"
            onPress={() => {
              setArmed(false);
              onTrash(item.id);
            }}
          />
        ) : (
          <Button
            size="sm"
            label="删除"
            variant="ghost"
            onPress={() => setArmed(true)}
          />
        )}
      </View>
    </Card>
  );
}

function GtdTipCard({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const [open, setOpen] = useState(defaultExpanded);
  const { isDark } = useAppTheme();
  return (
    <Card variant="subtle" className="mt-3.5 p-3.5 rounded-2xl border-border/60 bg-surface/60 dark:border-border-dark/60 dark:bg-surface-dark/60 shadow-2xs">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="展开或收起GTD澄清心法"
        onPress={() => setOpen((prev) => !prev)}
        className="flex-row items-center justify-between"
      >
        <View className="flex-row items-center gap-1.5">
          <Ionicons name="bulb-outline" size={14} color={isDark ? colors.accentDark : colors.accent} />
          <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
            GTD 澄清心法
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Text className="font-sans text-[11px] text-muted/70 dark:text-muted-dark/70">
            {open ? '收起' : '展开提示'}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={isDark ? colors.mutedDark : colors.muted}
          />
        </View>
      </Pressable>
      {open ? (
        <Text className="mt-2 font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
          收集箱不是待办清单，它是大脑的缓冲区。两分钟内能完成的事立即去做，复杂的转化为项目与下一步。
        </Text>
      ) : null}
    </Card>
  );
}
export default function InboxScreen() {
  const { data, error } = useInboxItems();
  const { data: waitingItems } = useWaitingForItems();
  const { add, error: captureError } = useAddInboxItem();
  const { trash, error: trashError } = useTrashInboxItem();
  const now = useAppClock();
  const { isDark } = useAppTheme();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(true);
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  // R1: the SINGLE handoff for both capture paths (modal onCaptured +
  // inline card) — close the modal (if open) and open the Clarify wizard
  // for the freshly captured item.
  const handoffToClarify = useCallback((item: InboxItem) => {
    setShowQuickCapture(false);
    router.push(`/clarify/${item.id}`);
  }, []);

  // "再记一条" from the wizard's done step arrives with recapture=1 —
  // one-shot consumption: reopen the modal and clear the param.
  const { recapture } = useLocalSearchParams<{ recapture?: string }>();
  useEffect(() => {
    if (recapture === '1') {
      setShowQuickCapture(true);
      router.setParams({ recapture: undefined });
    }
  }, [recapture]);

  const capture = async () => {
    const title = draft.trim();
    if (title === '' || saving) return;
    setSaving(true);
    try {
      const item = await add(title);
      if (item !== null) {
        setDraft('');
        handoffToClarify(item);
      }
    } finally {
      setSaving(false);
    }
  };

  const mutationError = captureError ?? trashError;

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 w-full bg-canvas px-4 pb-4 dark:bg-canvas-dark relative"
    >
      <View className="flex-1 w-full max-w-4xl mx-auto">
      {/* Header block (design §2) */}
      <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
        清空大脑
      </Text>
      <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
        先记下来，不用现在想清楚。
      </Text>

      {/* Capture card */}
      <Card className="mt-4 gap-3 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
        <TextInput
          className={INPUT_CLASS}
          value={draft}
          onChangeText={setDraft}
          placeholder="有什么事情占据着你现在的注意力？"
          onSubmitEditing={() => void capture()}
          blurOnSubmit={false}
        />
        <View className="flex-row items-center gap-2.5">
          <Text className="flex-1 font-sans text-xs text-muted dark:text-muted-dark">
            支持自然输入，待会儿逐个澄清
          </Text>
          <Button
            label="记录并澄清"
            variant="primary"
            onPress={() => void capture()}
            disabled={draft.trim() === '' || saving}
          />
        </View>
      </Card>

      {mutationError !== null ? (
        <Text className="mt-3 font-sans text-sm text-danger">{errorMessage(mutationError)}</Text>
      ) : null}

      {error !== null ? (
        <View className="mt-3">
          <EmptyState title="加载收件箱失败" hint={errorMessage(error)} />
        </View>
      ) : (
        <>
          {/* Count row */}
          <View className="mb-3 mt-4 flex-row items-center justify-between">
            <Tag label="待处理" count={data.length} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="查看等待事项"
              className="flex-row items-center gap-1 rounded-full border border-border/60 bg-surface/70 px-2.5 py-1 active:bg-surface-container dark:border-border-dark/60 dark:bg-surface-dark/70 dark:active:bg-surface-container-dark shadow-2xs"
              onPress={() => router.push('/waiting')}
            >
              <Ionicons name="time-outline" size={13} color={isDark ? colors.accentDark : colors.accent} />
              <Text className="font-sans text-xs font-medium text-accent dark:text-accent-dark">
                等待事项 ({waitingItems.length}) →
              </Text>
            </Pressable>
          </View>

          {data.length === 0 ? (
            <View className="mt-2 gap-2">
              <EmptyState
                title="收件箱是空的"
                hint="在上方输入并保存，这里会按捕获时间列出你记下的一切。"
                className="flex-initial py-6"
              />
              <GtdTipCard defaultExpanded />
            </View>
          ) : (
            <FlatList
              data={data}
              keyExtractor={(item) => item.id}
              contentContainerClassName="gap-2.5 pb-20 md:pb-6"
              renderItem={({ item }) => (
                <InboxRow item={item} now={now} onTrash={(id) => void trash(id)} />
              )}
              ListFooterComponent={<GtdTipCard />}
            />
          )}
        </>
      )}
      </View>

      {/* Mobile Ergonomic Floating Action Button (Thumb Zone):
       * Anchored at bottom-right for effortless one-handed thumb capture */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="快速记录"
        onPress={() => setShowQuickCapture(true)}
        className="absolute bottom-6 right-5 h-13 w-13 items-center justify-center rounded-full bg-accent shadow-xl active:scale-95 dark:bg-accent-dark md:hidden z-10"
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          elevation: 6,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
        }}
      >
        <Ionicons name="add" size={28} color={isDark ? colors.onAccentDark : colors.onAccent} />
      </Pressable>

      {/* On-launch & triggerable quick capture modal (R1: onCaptured hands
       *  the saved item to the Clarify wizard) */}
      <QuickCaptureModal
        visible={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onAdd={add}
        onCaptured={handoffToClarify}
        error={captureError}
      />
    </View>
  );
}
