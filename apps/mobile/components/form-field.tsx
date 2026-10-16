/**
 * A labelled form field: the field's name sits ABOVE the control and stays
 * visible once the control holds a value.
 *
 * Why it exists: a `TextInput` whose only name is its `placeholder` becomes
 * anonymous the moment the user types — a filled box reads as unexplained
 * text, and a `PickerField` loses its name as soon as a date is picked. The
 * placeholder stays a hint; the label carries the name. Same shape as the
 * clarify wizard's private `Field`, promoted here because the project
 * detail screen and the Projects tab both need it (component-guidelines:
 * promote a component at the second copy-paste).
 */
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { cn } from '@nextdo/ui';

export interface FormFieldProps {
  /** The field's name — always rendered, empty or filled. */
  label: string;
  /** Extra layout classes for the wrapper — `flex-1` when the field sits in a `flex-row`. */
  className?: string;
  children: ReactNode;
}

export function FormField({ label, className, children }: FormFieldProps) {
  return (
    <View className={cn('gap-1.5', className)}>
      <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">{label}</Text>
      {children}
    </View>
  );
}
