/**
 * The Inbox tab (design §2 — Paper Serenity rework): low-friction capture +
 * list. "清空大脑" — the buffer, not a to-do list.
 *
 * - capture is DECOUPLED from clarification (issue #58): Enter or [记录]
 *   saves the item and leaves it pending; [记录并澄清] (inline card and the
 *   quick capture modal) keeps the R1 one-tap handoff (记一条问一条);
 * - the count row names the pending state (待澄清) and [开始澄清] starts the
 *   batch walk at the oldest item — the wizard's done step then offers
 *   [澄清下一条], so the backlog can be cleared without coming back here;
 * - quick capture modal: automatically displayed on launch for zero-friction
 *   thought dump; its [记录] also leaves the item pending; "再记一条" from
 *   the wizard returns here via the one-shot `recapture=1` route param;
 * - list: oldest first; a row's title opens the Clarify wizard (R3) and the
 *   row's 处理 → button does the same; issue #106 adds the direct outcomes
 *   for a capture that needs no clarification: [完成] writes a do-now
 *   completion record (the daily review lists it; the capture stays
 *   restorable from Trash via 废弃) and [废弃] soft-deletes to Trash. The
 *   discard action confirms inline (one tap to arm, one tap to confirm);
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Card, EmptyState, Tag, colors } from '@nextdo/ui';
import { useInboxItems } from '@/hooks/use-inbox-items';
import { useAddInboxItem } from '@/hooks/use-add-inbox-item';
import { useCompleteInboxItem } from '@/hooks/use-complete-inbox-item';
import { useTrashInboxItem } from '@/hooks/use-trash-inbox-item';
import { useWaitingForItems } from '@/hooks/use-waiting-for';
import { useSomedayItems } from '@/hooks/use-someday-items';
import { useAppClock } from '@/hooks/use-app-clock';
import { useCaptureSchedule } from '@/hooks/use-capture-schedule';
import { formatRelativeTime } from '@/lib/format';
import { errorMessage } from '@/lib/error-messages';
import { clarifyHrefWithSchedule } from '@/lib/capture-link';
import { QuickCaptureModal } from '@/components/quick-capture-modal';
import { CaptureSchedulePreview } from '@/components/capture-schedule-preview';
import { useAppTheme } from '@/lib/theme';
import type { CaptureSchedule, InboxItem } from '@nextdo/core';

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** Captures older than this get the warning "优先澄清" meta (design §2). */
const PRIORITY_AFTER_MS = 24 * 60 * 60 * 1000;

/** One inbox row: tap the title → clarify; 完成 finishes the capture directly;
 *  废弃 arms, then trashes it (issue #106). */
function InboxRow({
  item,
  now,
  onComplete,
  onTrash,
}: {
  item: InboxItem;
  now: Date;
  onComplete: (id: string) => void;
  onTrash: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const needsPriority =
    now.getTime() - new Date(item.capturedAt).getTime() > PRIORITY_AFTER_MS;

  return (
    <Card variant="outlined" className="gap-2.5 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
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
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          label="完成"
          accessibilityLabel={`完成：${item.title}`}
          variant="primary"
          onPress={() => onComplete(item.id)}
        />
        {armed ? (
          <Button
            size="sm"
            label="确认废弃？"
            accessibilityLabel={`确认废弃：${item.title}`}
            variant="secondary"
            onPress={() => {
              setArmed(false);
              onTrash(item.id);
            }}
          />
        ) : (
          <Button
            size="sm"
            label="废弃"
            accessibilityLabel={`废弃：${item.title}`}
            variant="ghost"
            onPress={() => setArmed(true)}
          />
        )}
        <View className="flex-1" />
        <Button
          size="sm"
          label="处理 →"
          accessibilityLabel={`澄清：${item.title}`}
          variant="tinted"
          onPress={() => router.push(`/clarify/${item.id}`)}
        />
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
  const { data: somedayItems } = useSomedayItems();
  const { add, error: captureError } = useAddInboxItem();
  const { complete, error: completeError } = useCompleteInboxItem();
  const { trash, error: trashError } = useTrashInboxItem();
  const now = useAppClock();
  const { isDark } = useAppTheme();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(true);
  const { schedule, setSchedule, clear, reset } = useCaptureSchedule(draft, now);
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  // R1 handoff for the [记录并澄清] paths (modal + inline card) — close the
  // modal (if open) and open the Clarify wizard for the captured item. A
  // plain [记录] deliberately does NOT call this (issue #58). Issue #101:
  // the parsed date/time hint rides in route params so Clarify can prefill.
  const handoffToClarify = useCallback((item: InboxItem, parsed: CaptureSchedule | null) => {
    setShowQuickCapture(false);
    router.push(clarifyHrefWithSchedule(item.id, parsed));
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

  // Leaving the Inbox closes the on-launch capture modal. The modal lives in
  // this tab's tree, so a push to /waiting, /someday or the Clarify wizard
  // would otherwise keep it covering the pushed screen.
  useFocusEffect(
    useCallback(() => {
      return () => setShowQuickCapture(false);
    }, []),
  );

  const capture = async (mode: 'save' | 'clarify') => {
    const title = draft.trim();
    if (title === '' || saving) return;
    setSaving(true);
    try {
      const item = await add(title);
      if (item !== null) {
        setDraft('');
        // A completed capture is a new input (issue #101 review).
        reset();
        // save = just capture (the item stays pending); clarify = R1 handoff.
        if (mode === 'clarify') handoffToClarify(item, schedule);
      }
    } finally {
      setSaving(false);
    }
  };

  const mutationError = captureError ?? completeError ?? trashError;
  const startClarifyId = data[0]?.id ?? null;

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
          onSubmitEditing={() => void capture('save')}
          blurOnSubmit={false}
        />
        {schedule !== null ? (
          <CaptureSchedulePreview
            schedule={schedule}
            now={now}
            onChange={setSchedule}
            onClear={clear}
          />
        ) : null}
        <View className="flex-row items-center gap-2.5">
          <Text className="flex-1 font-sans text-xs text-muted dark:text-muted-dark">
            支持自然输入，待会儿逐个澄清
          </Text>
          <Button
            label="记录并澄清"
            variant="secondary"
            onPress={() => void capture('clarify')}
            disabled={draft.trim() === '' || saving}
          />
          <Button
            label="记录"
            variant="primary"
            onPress={() => void capture('save')}
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
          {/* Count row. The two groups wrap on narrow screens: at 360px the
              pending count + 开始澄清 and the two capsules do not fit on one
              line, so the capsule group moves to its own row. */}
          <View className="mb-3 mt-4 flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Tag label="待澄清" count={data.length} />
              {startClarifyId !== null ? (
                <Button
                  label="开始澄清"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push(`/clarify/${startClarifyId}?batch=1`)}
                />
              ) : null}
            </View>
            <View className="flex-row flex-wrap items-center justify-end gap-1.5">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="查看 Someday/Maybe"
                className="flex-row items-center gap-1 rounded-full border border-border/60 bg-surface/70 px-2.5 py-1 active:bg-surface-container dark:border-border-dark/60 dark:bg-surface-dark/70 dark:active:bg-surface-container-dark shadow-2xs"
                onPress={() => router.push('/someday')}
              >
                <Ionicons name="bookmark-outline" size={13} color={isDark ? colors.mutedDark : colors.muted} />
                <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">
                  Someday ({somedayItems.length}) →
                </Text>
              </Pressable>
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
                <InboxRow
                  item={item}
                  now={now}
                  onComplete={(id) => void complete(id)}
                  onTrash={(id) => void trash(id)}
                />
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

      {/* On-launch & triggerable quick capture modal (#58): [记录] leaves the
       *  item pending, [记录并澄清] keeps the R1 handoff */}
      <QuickCaptureModal
        visible={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onAdd={add}
        onCaptured={() => setShowQuickCapture(false)}
        onCapturedAndClarify={handoffToClarify}
        error={captureError}
      />
    </View>
  );
}
