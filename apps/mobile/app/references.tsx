/**
 * The reference library (issue #90) — external material saved from Clarify.
 *
 * The Clarify wizard's 「资料（留个参考）」 outcome already writes
 * `ReferenceItems`, but before this screen there was no way to find them
 * again. The library is an OPTIONAL feature (user-confirmed 2026-11-19):
 * the Settings switch hides the Now entry and the Clarify choice without
 * deleting anything already stored.
 *
 * v1 is links + notes, not a document manager:
 *   - list title / note / URL domain;
 *   - client-side search over title, note and URL;
 *   - open the link (only when a URL exists), edit title/URL/note, soft-delete;
 *   - an invalid non-empty URL is rejected at save time with a recoverable
 *     inline error — the row keeps its previous value.
 *
 * Data comes from `useReferenceItems` (a live watch query); every mutation
 * goes through that hook and errors map through `errorMessage`.
 */
import { useMemo, useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { Button, Card, EmptyState, MarkdownNote, Tag } from '@nextdo/ui';
import type { ReferenceItem } from '@nextdo/core';
import { useAppInsets } from '@/lib/use-app-insets';
import { useReferenceItems, type ReferenceItemPatch } from '@/hooks/use-reference-items';
import { errorMessage } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';
import { openExternalUrl } from '@/lib/app-update';
import { parseReferenceUrl } from '@/lib/reference-url';

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** One reference; 编辑 opens an inline form, 删除 arms first, then confirms. */
function ReferenceCard({
  item,
  onUpdate,
  onTrash,
}: {
  item: ReferenceItem;
  onUpdate: (item: ReferenceItem, patch: ReferenceItemPatch) => Promise<boolean>;
  onTrash: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const parsedUrl = parseReferenceUrl(item.url ?? '');

  const startEditing = () => {
    setTitle(item.title);
    setUrl(item.url ?? '');
    setNote(item.note ?? '');
    setFormError(null);
    setArmed(false);
    setEditing(true);
  };

  const save = async () => {
    const nextTitle = title.trim();
    if (nextTitle === '') {
      setFormError('请填写资料标题');
      return;
    }
    const nextUrl = url.trim();
    if (nextUrl !== '' && parseReferenceUrl(nextUrl) === null) {
      setFormError('链接格式不正确（需要有效的 http:// 或 https:// 地址）');
      return;
    }
    setFormError(null);
    setSaving(true);
    const ok = await onUpdate(item, {
      title: nextTitle,
      url: nextUrl === '' ? undefined : nextUrl,
      note: note.trim() === '' ? undefined : note.trim(),
    });
    setSaving(false);
    if (ok) setEditing(false);
  };

  const open = async () => {
    const target = parseReferenceUrl(item.url ?? '');
    if (target === null) {
      // Rows written before the library existed can carry any non-empty
      // string. Never pass an unsupported scheme to the OS opener.
      setFormError('这个链接不是有效的 http(s) 地址，无法打开。请编辑后重试。');
      return;
    }
    setFormError(null);
    setOpening(true);
    try {
      await openExternalUrl(target.url.href);
    } catch (err: unknown) {
      setFormError(`无法打开链接：${errorMessage(err)}`);
    } finally {
      setOpening(false);
    }
  };

  if (editing) {
    return (
      <Card variant="outlined" className="gap-3 p-3.5">
        <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
          编辑资料
        </Text>
        <TextInput
          accessibilityLabel="资料标题"
          className={INPUT_CLASS}
          placeholder="资料标题"
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          accessibilityLabel="资料链接"
          className={INPUT_CLASS}
          placeholder="https://…（可选）"
          autoCapitalize="none"
          value={url}
          onChangeText={setUrl}
        />
        <TextInput
          accessibilityLabel="资料备注"
          className={INPUT_CLASS}
          placeholder="备注（可选，支持 Markdown）"
          multiline
          value={note}
          onChangeText={setNote}
        />
        {formError !== null ? (
          <Text className="font-sans text-sm text-danger dark:text-danger-dark">{formError}</Text>
        ) : null}
        <View className="flex-row gap-2">
          <Button
            size="sm"
            label={saving ? '保存中…' : '保存'}
            disabled={saving}
            onPress={() => void save()}
          />
          <Button
            size="sm"
            label="取消"
            variant="secondary"
            onPress={() => {
              setEditing(false);
              setFormError(null);
            }}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card variant="outlined" className="gap-2 p-3.5">
      <Text className="font-sans text-base font-medium text-ink dark:text-ink-dark">
        {item.title}
      </Text>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {parsedUrl !== null ? (
          <Tag label={parsedUrl.domain} tone="neutral" />
        ) : item.url !== undefined && item.url !== '' ? (
          <Tag label="链接格式异常" tone="warning" />
        ) : (
          <Tag label="无链接" tone="neutral" />
        )}
      </View>
      {parsedUrl === null && item.url !== undefined && item.url !== '' ? (
        <Text className="font-sans text-xs text-danger dark:text-danger-dark">
          链接格式不受支持，无法打开。请编辑为 http:// 或 https:// 地址。
        </Text>
      ) : null}
      {item.note !== undefined ? (
        // The note is the user's raw Markdown; the row is a preview, not the
        // document — cap it so a long note cannot swallow the list.
        <MarkdownNote mode="inline" numberOfLines={3} value={item.note} />
      ) : null}
      {formError !== null ? (
        <Text className="font-sans text-sm text-danger dark:text-danger-dark">{formError}</Text>
      ) : null}
      <View className="mt-1 flex-row flex-wrap items-center gap-2">
        {parsedUrl !== null ? (
          <Button
            size="sm"
            label={opening ? '打开中…' : '打开链接'}
            variant="secondary"
            disabled={opening}
            accessibilityLabel={`打开链接：${item.title}`}
            onPress={() => void open()}
          />
        ) : null}
        <Button
          size="sm"
          label="编辑"
          variant="ghost"
          accessibilityLabel={`编辑资料：${item.title}`}
          onPress={startEditing}
        />
        {armed ? (
          <Button
            size="sm"
            label="确认删除？"
            variant="secondary"
            accessibilityLabel={`确认删除资料：${item.title}`}
            onPress={() => {
              setArmed(false);
              void onTrash(item.id);
            }}
          />
        ) : (
          <Button
            size="sm"
            label="删除"
            variant="ghost"
            accessibilityLabel={`删除资料：${item.title}`}
            onPress={() => setArmed(true)}
          />
        )}
      </View>
    </Card>
  );
}

export default function ReferencesScreen() {
  const { data, error, isLoading, update, trash, mutationError } = useReferenceItems();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const [query, setQuery] = useState('');
  const message = error ?? mutationError;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return data;
    return data.filter((item) =>
      [item.title, item.note ?? '', item.url ?? ''].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [data, query]);

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <View className="mx-auto w-full max-w-4xl flex-1">
        <View className="mb-2 flex-row items-center justify-between">
          <Button label="← 现在" variant="ghost" onPress={() => goBack('/(tabs)/now')} />
        </View>

        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          资料库
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          外部资料与链接。澄清时选择「资料（留个参考）」的内容会出现在这里，可以搜索、编辑或删除。
          关闭资料库只会隐藏入口，已有资料保留。
        </Text>

        <TextInput
          accessibilityLabel="搜索资料"
          className="mt-4 rounded-xl border border-border/80 bg-surface px-3.5 py-2.5 font-sans text-sm text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark"
          placeholder="搜索标题、备注或链接"
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
        />

        {message !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
            {errorMessage(message)}
          </Text>
        ) : null}

        <Text className="mb-2 mt-4 font-sans text-sm font-medium text-muted dark:text-muted-dark">
          {query.trim() === '' ? `资料 (${data.length})` : `找到 ${filtered.length} 条`}
        </Text>

        {filtered.length === 0 ? (
          isLoading ? (
            <Text className="mt-2 font-sans text-sm text-muted dark:text-muted-dark">加载中…</Text>
          ) : error !== null ? (
            <EmptyState
              title="资料库加载失败"
              hint="请检查后重试；已保存的资料仍在本机，不会因为这次读取失败而丢失。"
            />
          ) : data.length === 0 ? (
            <EmptyState
              title="资料库是空的"
              hint="澄清时选择「资料（留个参考）」，资料就会出现在这里。"
            />
          ) : (
            <EmptyState title="没有匹配的资料" hint="换个关键词试试。" />
          )
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-2.5 pb-20 md:pb-6"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <ReferenceCard item={item} onUpdate={update} onTrash={trash} />
            )}
          />
        )}
      </View>
    </View>
  );
}
