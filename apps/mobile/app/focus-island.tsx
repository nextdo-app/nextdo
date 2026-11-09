import { Text, View } from 'react-native';
import { Button } from '@nextdo/ui';
import { goBack } from '@/lib/go-back';

/** Native capsules are rendered by the lightweight root before this route mounts. */
export default function FocusIslandRoute() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-canvas p-6 dark:bg-canvas-dark">
      <Text className="text-base text-ink dark:text-ink-dark">独立专注岛仅在桌面应用中可用</Text>
      <Button label="返回现在" onPress={() => goBack('/(tabs)/now')} />
    </View>
  );
}
