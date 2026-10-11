/**
 * Tab bar (design.md §4): Inbox / Now / Projects / Review / Settings.
 *
 * Responsive layout:
 * - Mobile (< 768px): Native bottom tab bar with safe-area insets.
 * - Desktop / Wide screen (>= 768px): Centered floating pill dock with subtle borders and shadows.
 */
import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';
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
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const bottomPadding = Math.max(insets.bottom, 8);

  const tabBarStyle: ViewStyle = isDesktop
    ? {
        position: 'absolute',
        bottom: 20,
        left: Math.max((width - 560) / 2, 24),
        width: Math.min(width - 48, 560),
        height: 56,
        borderRadius: 28,
        backgroundColor: isDark ? colors.surfaceDark : colors.surface,
        borderColor: isDark ? colors.borderDark : colors.border,
        borderWidth: 1,
        paddingBottom: 6,
        paddingTop: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: isDark ? 0.35 : 0.08,
        shadowRadius: 16,
        elevation: 12,
        ...(Platform.OS === 'web'
          ? ({
              position: 'fixed',
              left: '50%',
              transform: [{ translateX: -Math.min(width - 48, 560) / 2 }],
            } as unknown as ViewStyle)
          : {}),
      }
    : {
        backgroundColor: isDark ? colors.surfaceDark : colors.surface,
        borderTopColor: isDark ? colors.borderDark : colors.border,
        borderTopWidth: 0.5,
        height: 64 + (insets.bottom > 0 ? insets.bottom : 0),
        paddingBottom: bottomPadding,
        paddingTop: 6,
      };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? colors.accentDark : colors.accent,
        tabBarInactiveTintColor: isDark ? colors.mutedDark : colors.muted,
        tabBarStyle,
        tabBarLabelStyle: {
          fontSize: isDesktop ? 12 : 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          title: '收件箱',
          tabBarIcon: ({ color }) => (
            <Ionicons name="file-tray-outline" size={isDesktop ? 22 : 20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="now"
        options={{
          title: '现在',
          tabBarIcon: ({ color }) => (
            <Ionicons name="compass-outline" size={isDesktop ? 22 : 20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: '项目',
          tabBarIcon: ({ color }) => (
            <Ionicons name="folder-outline" size={isDesktop ? 22 : 20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: '回顾',
          tabBarIcon: ({ color }) => (
            <Ionicons name="checkmark-circle-outline" size={isDesktop ? 22 : 20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color }) => (
            <Ionicons name="settings-outline" size={isDesktop ? 22 : 20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
