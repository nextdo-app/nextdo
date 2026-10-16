/**
 * Tab bar (design.md §4): Inbox / Now / Projects / Review / Settings.
 *
 * Reordered with Inbox first for zero-friction GTD capture on launch.
 * iOS styled with subtle top border, clear active tint, and touch padding.
 * Settings is the 5th tab (prod-deploy R6 — cloud sync is optional,
 * configured there).
 */
import { type ViewStyle } from 'react-native';
import { Tabs } from 'expo-router';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';
// Subpath import on purpose: the package root re-exports every icon set and
// Metro statically follows each `require`, bundling all 19 icon fonts. Importing
// only the one family we use keeps Ionicons.ttf and drops the rest.
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@nextdo/ui';

export default function TabsLayout() {
  const { isDark } = useAppTheme();
  const insets = useAppInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  const tabBarStyle: ViewStyle = {
    backgroundColor: isDark ? colors.surfaceDark : colors.surface,
    borderTopColor: isDark ? colors.borderDark : colors.border,
    borderTopWidth: 0.5,
    height: 64 + (insets.bottom > 0 ? insets.bottom : 0),
    paddingBottom: bottomPadding,
    paddingTop: 6,
    paddingLeft: Math.max(insets.left, 8),
    paddingRight: Math.max(insets.right, 8),
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? colors.accentDark : colors.accent,
        tabBarInactiveTintColor: isDark ? colors.mutedDark : colors.muted,
        tabBarStyle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          title: '收件箱',
          tabBarIcon: ({ color }) => (
            <Ionicons name="file-tray-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="now"
        options={{
          title: '现在',
          tabBarIcon: ({ color }) => (
            <Ionicons name="compass-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: '项目',
          tabBarIcon: ({ color }) => (
            <Ionicons name="folder-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: '回顾',
          tabBarIcon: ({ color }) => (
            <Ionicons name="checkmark-circle-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color }) => (
            <Ionicons name="settings-outline" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
