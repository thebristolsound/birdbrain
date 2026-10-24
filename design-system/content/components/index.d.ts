// Birdbrain ui primitives — types as documentation, transcribed from
// src/renderer/components/ui/*.tsx at thebristolsound/birdbrain@f6e2d98.
// The real components live at @renderer/components/ui; no bundle ships here.

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes
} from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** default: accent fill. destructive: red-600. outline: border-strong. ghost: text-muted, elevated on hover. link: accent text. */
  variant?: 'default' | 'destructive' | 'outline' | 'ghost' | 'link'
  /** xs, sm and default all alias the one control metric (28px / 4px / 0 11px / 12px); lg is 36px for the hero CTA; icon 28px square; icon-sm 24px. */
  size?: 'xs' | 'sm' | 'default' | 'lg' | 'icon' | 'icon-sm'
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'accent' | 'success' | 'danger' | 'warning'
  /** sm (the default) sets the label in mono; pill is the 28px case-type pill. */
  size?: 'sm' | 'default' | 'pill'
  /** A 6px currentColor disc before the label. */
  dot?: boolean
  /** Animate the dot for a live state. */
  pulse?: boolean
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>
export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Border turns color-border-strong on hover. */
  hover?: boolean
  /** The whole card is a target: a 2px lift on the hover spring. */
  interactive?: boolean
}
export type CardHeaderProps = HTMLAttributes<HTMLDivElement>
export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>
export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>
export type CardContentProps = HTMLAttributes<HTMLDivElement>
export type CardFooterProps = HTMLAttributes<HTMLDivElement>
/** The recessed inner surface: border-strong on color-surface, 12px padding. */
export type CardPanelProps = HTMLAttributes<HTMLDivElement>

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  /** faint: 10px text-faint (default). strong: 11px text-secondary. */
  emphasis?: 'faint' | 'strong'
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}
export interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  onClose: () => void
}
export type DialogHeaderProps = HTMLAttributes<HTMLDivElement>
export type DialogTitleProps = HTMLAttributes<HTMLHeadingElement>
export type DialogDescriptionProps = HTMLAttributes<HTMLParagraphElement>
export type DialogFooterProps = HTMLAttributes<HTMLDivElement>

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
}
export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  /** default: a color-muted track with a raised active trigger. line: transparent with a 2px underline. */
  variant?: 'default' | 'line'
}
export interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}
export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string
}

export interface ContextMenuItemProps extends HTMLAttributes<HTMLDivElement> {
  /** Sets the item in color-danger-fg. */
  danger?: boolean
  disabled?: boolean
}
export interface ContextMenuHeaderProps {
  icon: ReactNode
  title: string
  subtitle: string
}
export interface ContextMenuShortcutProps {
  /** Only a route that exists. */
  children: ReactNode
}

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement>
export type SkeletonProps = HTMLAttributes<HTMLDivElement>
/** Mount once at the root; no props. Toasts are raised through sonner's toast(). */
export type AppToasterProps = Record<string, never>
