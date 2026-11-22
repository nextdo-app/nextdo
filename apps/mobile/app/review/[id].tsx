import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card } from '@nextdo/ui';
import { useReviewDetail } from '@/hooks/use-review-detail';
import { useAppInsets } from '@/lib/use-app-insets';
import { goBack } from '@/lib/go-back';
import { formatLocalDateTime } from '@/lib/format';
import { reviewDetailSections } from '@/lib/review-detail';

export default function ReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useReviewDetail(id ?? '');
  const insets = useAppInsets();
  return (
    <View style={{ paddingTop: Math.max(insets.top, 16) }} className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark">
      <ScrollView contentContainerClassName="gap-4">
        <Button label="← 回顾" variant="ghost" onPress={() => goBack('/(tabs)/review')} />
        <Text className="text-xl font-semibold text-ink dark:text-ink-dark">回顾详情</Text>
        {loading ? <Text className="text-sm text-muted dark:text-muted-dark">加载中…</Text> : error !== null ? (
          <Card className="gap-2">
            <Text className="text-danger">加载回顾详情失败：{error}</Text>
            <Button label="重试加载" onPress={reload} />
          </Card>
        ) : data === null ? (
          <Card className="gap-2">
            <Text className="text-sm text-muted dark:text-muted-dark">找不到这条回顾记录。</Text>
            <Button label="重试加载" onPress={reload} />
          </Card>
        ) : (
          <>
            <Text className="text-base text-ink dark:text-ink-dark">{data.record.kind === 'daily' ? '今日回顾' : '本周回顾'} · {formatLocalDateTime(data.record.at)}</Text>
            <Text className="text-sm text-muted dark:text-muted-dark">此页显示提交时保存的记录。安排到次日的时间按查看设备的当前时区重算。标有「当前标题」的旧记录使用现有名称，原名称无法恢复。项目、等待事项和 Someday 条目可打开对应页面。</Text>
            {reviewDetailSections(data.record, data.currentTitles).map((section) => (
              <Card key={section.title} className="gap-2">
                <Text className="text-base font-medium text-ink dark:text-ink-dark">{section.title}</Text>
                {section.entries.length === 0 ? <Text className="text-sm text-muted dark:text-muted-dark">无</Text> : section.entries.map((entry, index) => {
                  const href = entry.href;
                  if (href === undefined) {
                    return <Text key={`${index}:${entry.text}`} className="text-sm text-ink dark:text-ink-dark">{entry.text}</Text>;
                  }
                  return (
                    <Pressable
                      key={`${index}:${entry.text}`}
                      accessibilityRole="link"
                      accessibilityLabel={`打开：${entry.text}`}
                      onPress={() => router.push(href)}
                      className="min-h-9 justify-center rounded-lg py-1 active:bg-surface-container dark:active:bg-surface-container-dark"
                    >
                      <Text className="text-sm text-accent dark:text-accent-dark">{entry.text} →</Text>
                    </Pressable>
                  );
                })}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
