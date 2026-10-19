/**
 * Clarify wizard route (design.md §2): full Q1–Q5 decision-table walk for an
 * InboxItem. Modal-style full screen — the root layout is headerless, the
 * wizard draws its own back button.
 *
 * `batch=1` (issue #58) marks a pass started from the inbox's [开始澄清]:
 * the done step then continues with [澄清下一条] instead of [再记一条].
 */
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ClarifyWizard } from '@/components/clarify-wizard';

export default function ClarifyScreen() {
  const { inboxId, batch } = useLocalSearchParams<{ inboxId: string; batch?: string }>();
  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <ClarifyWizard
        mode="clarify"
        id={typeof inboxId === 'string' ? inboxId : null}
        batch={batch === '1'}
      />
    </View>
  );
}
