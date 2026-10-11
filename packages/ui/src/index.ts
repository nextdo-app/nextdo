/**
 * @nextdo/ui — design tokens + shared cross-platform components.
 *
 * The package's single entrypoint; every public symbol is re-exported
 * explicitly (spec: project/directory-structure.md Rule 3;
 * project/conventions.md §Exports).
 *
 * Component list is exactly what the mobile shell uses (design.md §5 — no
 * speculative components): Button, Card, Tag, EmptyState, ContextChip,
 * ProgressBar, ValueChips.
 */
export { cn } from './lib/cn';
export { Button } from './components/button';
export type { ButtonProps } from './components/button';
export { Card } from './components/card';
export type { CardProps, CardVariant } from './components/card';
export { Tag } from './components/tag';
export type { TagProps, TagTone } from './components/tag';
export { EmptyState } from './components/empty-state';
export type { EmptyStateProps } from './components/empty-state';
export { ContextChip, contextTone } from './components/context-chip';
export type { ContextChipProps } from './components/context-chip';
export {
  SceneOption,
  SCENE_OPTION_HIT_SLOP,
  SCENE_OPTION_UNSELECTED_CLASS,
  SCENE_OPTION_SELECTED_CLASS,
} from './components/scene-option';
export type { SceneOptionProps } from './components/scene-option';
export { ProgressBar } from './components/progress-bar';
export type { ProgressBarProps } from './components/progress-bar';
export { ValueChips } from './components/value-chips';
export type { ValueChipsProps } from './components/value-chips';
export { colors, radii, spacing, typography } from './tokens';
export type {
  ColorToken,
  RadiusToken,
  SpacingToken,
  TypographyToken,
} from './tokens';
