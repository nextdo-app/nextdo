/**
 * Markdown note renderer (task 10-22-note-markdown-rendering).
 *
 * The parsing lives in `@nextdo/core` (`parseMarkdown`) so it is pure and
 * testable without React; this file only turns that tree into RN primitives.
 * Kept in `packages/ui` because two screens render a note (the Now card and
 * the project detail screen) and the rules must not diverge.
 *
 * Two shapes, one parser:
 *   - `MarkdownNote` (default): full block layout — headings, lists, quotes,
 *     fenced code. Used where the note is the content.
 *   - `inline`: every block flattened into ONE text run with the emphasis
 *     kept and line breaks dropped, so `numberOfLines` still truncates. Used
 *     inside a list row that must not grow with the note.
 *
 * Links are rendered as accent-coloured text and are NOT tappable in `inline`
 * mode (a truncated row must not contain a surprise link target); in block
 * mode `onLinkPress` decides — the caller owns URL opening, because
 * `Linking` is a platform concern the UI package does not import.
 */
import { Text, View } from 'react-native';

import {
  markdownInlineSummary,
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from '@nextdo/core';

import { cn } from '../lib/cn';

export interface MarkdownNoteProps {
  /** The raw note text as stored (never pre-processed). */
  value: string;
  /**
   * `inline`: one flattened run of text (use with `numberOfLines`).
   * `block`: the full document layout.
   */
  mode?: 'block' | 'inline';
  /** Truncation for `inline` mode; ignored in `block` mode. */
  numberOfLines?: number;
  /** Block mode only. Omitted → links render as plain accent text. */
  onLinkPress?: (href: string) => void;
  className?: string;
}

const HEADING_CLASSES: Record<1 | 2 | 3, string> = {
  1: 'font-sans text-base font-bold text-ink dark:text-ink-dark',
  2: 'font-sans text-sm font-bold text-ink dark:text-ink-dark',
  3: 'font-sans text-sm font-semibold text-ink dark:text-ink-dark',
};

const BODY_CLASS = 'font-sans text-sm leading-snug text-muted dark:text-muted-dark';
const LINK_CLASS = 'text-accent underline dark:text-accent-dark';

function InlineRun({
  nodes,
  mode,
  onLinkPress,
}: {
  nodes: MarkdownInline[];
  mode: 'block' | 'inline';
  onLinkPress?: (href: string) => void;
}) {
  return (
    <>
      {nodes.map((node, index) => {
        const key = `${node.type}-${index}`;
        switch (node.type) {
          case 'text':
            return <Text key={key}>{node.text}</Text>;
          case 'strong':
            return (
              <Text key={key} className="font-bold text-ink dark:text-ink-dark">
                <InlineRun nodes={node.children} mode={mode} onLinkPress={onLinkPress} />
              </Text>
            );
          case 'em':
            return (
              <Text key={key} className="italic">
                <InlineRun nodes={node.children} mode={mode} onLinkPress={onLinkPress} />
              </Text>
            );
          case 'strike':
            return (
              <Text key={key} className="line-through">
                <InlineRun nodes={node.children} mode={mode} onLinkPress={onLinkPress} />
              </Text>
            );
          case 'code':
            return (
              <Text
                key={key}
                className="rounded bg-surface-container/70 px-1 font-mono text-[13px] text-ink dark:bg-surface-container-dark/70 dark:text-ink-dark"
              >
                {node.text}
              </Text>
            );
          case 'link': {
            const canOpen = mode === 'block' && onLinkPress !== undefined;
            return (
              <Text
                key={key}
                className={LINK_CLASS}
                accessibilityRole={canOpen ? 'link' : undefined}
                onPress={canOpen ? () => onLinkPress(node.href) : undefined}
              >
                {node.text}
              </Text>
            );
          }
        }
      })}
    </>
  );
}

/** Full block layout — one `<Text>` per paragraph-ish block, markers removed. */
function BlockNote({
  blocks,
  onLinkPress,
}: {
  blocks: MarkdownBlock[];
  onLinkPress?: (href: string) => void;
}) {
  return (
    <View className="gap-1.5">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'heading':
            return (
              <Text key={key} className={HEADING_CLASSES[block.level]}>
                <InlineRun nodes={block.children} mode="block" onLinkPress={onLinkPress} />
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={key} className={BODY_CLASS}>
                <InlineRun nodes={block.children} mode="block" onLinkPress={onLinkPress} />
              </Text>
            );
          case 'quote':
            return (
              <View
                key={key}
                className="border-l-2 border-border/70 pl-2 dark:border-border-dark/70"
              >
                <Text className={cn(BODY_CLASS, 'italic')}>
                  <InlineRun nodes={block.children} mode="block" onLinkPress={onLinkPress} />
                </Text>
              </View>
            );
          case 'code':
            return (
              <View
                key={key}
                className="rounded-lg bg-surface-container/60 p-2 dark:bg-surface-container-dark/60"
              >
                <Text className="font-mono text-[13px] leading-snug text-ink dark:text-ink-dark">
                  {block.text}
                </Text>
              </View>
            );
          case 'list':
            return (
              <View key={key} className="gap-0.5">
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-${itemIndex}`} className="flex-row gap-1.5">
                    <Text className={BODY_CLASS}>
                      {block.ordered ? `${itemIndex + 1}.` : '•'}
                    </Text>
                    <Text className={cn(BODY_CLASS, 'flex-1')}>
                      <InlineRun nodes={item} mode="block" onLinkPress={onLinkPress} />
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

export function MarkdownNote({
  value,
  mode = 'block',
  numberOfLines,
  onLinkPress,
  className,
}: MarkdownNoteProps) {
  if (value.trim() === '') return null;

  if (mode === 'inline') {
    return (
      <Text
        numberOfLines={numberOfLines}
        className={cn(BODY_CLASS, className)}
        // The summary is decoration-free text; keep it readable as one run.
        accessibilityLabel={value}
      >
        <InlineRun nodes={markdownInlineSummary(value)} mode="inline" />
      </Text>
    );
  }

  return (
    <View className={className}>
      <BlockNote blocks={parseMarkdown(value)} onLinkPress={onLinkPress} />
    </View>
  );
}
