# Token Sync Manifest

> Rosetta Stone: maps every design token to its CSS, Tailwind, Figma, and Flutter equivalents.
> Source of truth: `frontend/tailwind.config.js`

---

## Colors — Dark / Surface

| Token Path | Hex | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-----|-------------------|----------------|----------------|------------------|
| `primitives.color.dark.900` | `#0a0a0f` | `--color-dark-900` | `bg-dark-900` | `dark/900` | `AppColors.darkest` |
| `primitives.color.dark.800` | `#13131a` | `--color-dark-800` | `bg-dark-800` | `dark/800` | `AppColors.background` |
| `primitives.color.dark.700` | `#1a1a24` | `--color-dark-700` | `bg-dark-700` | `dark/700` | `AppColors.surface` |
| `primitives.color.dark.600` | `#252533` | `--color-dark-600` | `bg-dark-600` | `dark/600` | `AppColors.surfaceLight` |
| `primitives.color.dark.500` | `#2d2d3d` | `--color-dark-500` | `bg-dark-500` | `dark/500` | `AppColors.surfaceLighter` |

## Colors — Primary (Purple)

| Token Path | Hex | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-----|-------------------|----------------|----------------|------------------|
| `primitives.color.primary.400` | `#9333ea` | `--color-primary-400` | `text-primary-400` | `primary/400` | `AppColors.primary400` |
| `primitives.color.primary.500` | `#7c3aed` | `--color-primary-500` | `bg-primary-500` | `primary/500` | `AppColors.primary500` |
| `primitives.color.primary.600` | `#6d28d9` | `--color-primary-600` | `bg-primary-600` | `primary/600` | `AppColors.primary600` |
| `primitives.color.primary.700` | `#5b21b6` | `--color-primary-700` | `bg-primary-700` | `primary/700` | `AppColors.primary700` |

## Colors — Indigo

| Token Path | Hex | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-----|-------------------|----------------|----------------|------------------|
| `primitives.color.indigo.500` | `#6366f1` | `--color-indigo-500` | `text-indigo-500` | `indigo/500` | `AppColors.indigo500` |

## Colors — Accent (Blue)

| Token Path | Hex | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-----|-------------------|----------------|----------------|------------------|
| `primitives.color.accent.400` | `#60a5fa` | `--color-accent-400` | `text-accent-400` | `accent/400` | `AppColors.accent400` |
| `primitives.color.accent.500` | `#3b82f6` | `--color-accent-500` | `bg-accent-500` | `accent/500` | `AppColors.accent500` |
| `primitives.color.accent.600` | `#2563eb` | `--color-accent-600` | `bg-accent-600` | `accent/600` | `AppColors.accent600` |

## Colors — Status

| Token Path | Hex | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-----|-------------------|----------------|----------------|------------------|
| `primitives.color.success.500` | `#10b981` | `--color-success-500` | `text-success-500` | `success/500` | `AppColors.success` |
| `primitives.color.success.600` | `#059669` | `--color-success-600` | `text-success-600` | `success/600` | — |
| `primitives.color.error.500` | `#ef4444` | `--color-error-500` | `text-error-500` | `error/500` | `AppColors.error` |
| `primitives.color.error.600` | `#dc2626` | `--color-error-600` | `text-error-600` | `error/600` | — |
| `primitives.color.warning.500` | `#f59e0b` | `--color-warning-500` | `text-warning-500` | `warning/500` | `AppColors.warning` |
| `primitives.color.warning.600` | `#d97706` | `--color-warning-600` | `text-warning-600` | `warning/600` | — |

## Colors — Unmentionables (Rose)

| Token Path | Hex | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-----|-------------------|----------------|----------------|------------------|
| `primitives.color.unmentionables.300` | `#fda4af` | `--color-unmentionables-300` | `text-unmentionables-300` | `unmentionables/300` | — |
| `primitives.color.unmentionables.400` | `#fb7185` | `--color-unmentionables-400` | `text-unmentionables-400` | `unmentionables/400` | — |
| `primitives.color.unmentionables.500` | `#e11d48` | `--color-unmentionables-500` | `bg-unmentionables-500` | `unmentionables/500` | — |

## Colors — Glass

| Token Path | Value | CSS Custom Property | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-------|-------------------|----------------|----------------|------------------|
| `primitives.color.glass.bg` | `rgba(255,255,255,0.04)` | `--color-glass-bg` | `bg-glass-bg` | `glass/bg` | `AppColors.glassBg` |
| `primitives.color.glass.border` | `rgba(255,255,255,0.08)` | `--color-glass-border` | `border-glass-border` | `glass/border` | `AppColors.glassBorder` |
| `primitives.color.glass.border-hover` | `rgba(255,255,255,0.14)` | `--color-glass-border-hover` | `border-glass-border-hover` | `glass/border-hover` | `AppColors.glassBorderHover` |

## Colors — Text

| Token Path | Value | Tailwind Class | Figma Variable | Flutter Constant |
|------------|-------|----------------|----------------|------------------|
| `semantic.text.primary` | `#ffffff` | `text-white` | `text/primary` | `AppColors.textPrimary` |
| `semantic.text.secondary` | `rgba(255,255,255,0.70)` | `text-white/70` | `text/secondary` | `AppColors.textSecondary` |
| `semantic.text.tertiary` | `rgba(255,255,255,0.50)` | `text-white/50` | `text/tertiary` | `AppColors.textTertiary` |
| `semantic.text.disabled` | `rgba(255,255,255,0.30)` | `text-white/30` | `text/disabled` | — |

## Border Radius

| Token Path | Value | Tailwind Class | Figma Variable | Flutter |
|------------|-------|----------------|----------------|---------|
| `primitives.borderRadius.card` | `20px` | `rounded-card` / `rounded-2xl` | `radius/card` | `BorderRadius.circular(20)` |
| `primitives.borderRadius.btn` | `12px` | `rounded-btn` | `radius/btn` | `BorderRadius.circular(12)` |
| `primitives.borderRadius.full` | `9999px` | `rounded-full` | `radius/full` | `BorderRadius.circular(9999)` |

## Shadows

| Token Path | Value | Tailwind Class | CSS Utility | Figma Style |
|------------|-------|----------------|-------------|-------------|
| `semantic.shadow.glow` | `0 4px 24px rgba(124,58,237,0.25)` | `shadow-glow` | `.shadow-glow` | `shadow/glow` |
| `semantic.shadow.glowIntense` | `0 8px 32px rgba(124,58,237,0.35)` | `shadow-glow-intense` | `.shadow-glow-intense` | `shadow/glow-intense` |
| `semantic.shadow.glowUnmentionables` | `0 0 20px rgba(225,29,72,0.3)` | — | `.shadow-glow-unmentionables` | `shadow/glow-um` |

## Gradients

| Token Path | Value | CSS Utility | Figma Style | Flutter |
|------------|-------|-------------|-------------|---------|
| `semantic.gradient.primary` | `135deg: #7c3aed → #6366f1 → #3b82f6` | `.bg-gradient-primary` / `.text-gradient` | `gradient/primary` | `AppColors.primaryGradient` |
| `semantic.gradient.unmentionables` | `135deg: #e11d48 → #7c3aed` | `.bg-gradient-unmentionables` | `gradient/unmentionables` | — |

## Typography

| Token Path | Value | Tailwind Class | Figma Style | Flutter |
|------------|-------|----------------|-------------|---------|
| `primitives.typography.fontFamily.sans` | Plus Jakarta Sans | `font-sans` (default) | `font/sans` | `GoogleFonts.plusJakartaSans()` |
| `primitives.typography.fontSize.xs` | 12px / 0.75rem | `text-xs` | `type/xs` | `12.0` |
| `primitives.typography.fontSize.sm` | 14px / 0.875rem | `text-sm` | `type/sm` | `14.0` |
| `primitives.typography.fontSize.base` | 16px / 1rem | `text-base` | `type/base` | `16.0` |
| `primitives.typography.fontSize.lg` | 18px / 1.125rem | `text-lg` | `type/lg` | `18.0` |
| `primitives.typography.fontSize.xl` | 20px / 1.25rem | `text-xl` | `type/xl` | `20.0` |
| `primitives.typography.fontSize.2xl` | 24px / 1.5rem | `text-2xl` | `type/2xl` | `24.0` |
| `primitives.typography.fontSize.3xl` | 30px / 1.875rem | `text-3xl` | `type/3xl` | `30.0` |
| `primitives.typography.fontSize.4xl` | 36px / 2.25rem | `text-4xl` | `type/4xl` | `36.0` |

## Spacing

| Token Path | Value | Tailwind Class | Figma Variable |
|------------|-------|----------------|----------------|
| `primitives.spacing.1` | 4px | `p-1` / `m-1` / `gap-1` | `spacing/1` |
| `primitives.spacing.2` | 8px | `p-2` / `m-2` / `gap-2` | `spacing/2` |
| `primitives.spacing.3` | 12px | `p-3` / `m-3` / `gap-3` | `spacing/3` |
| `primitives.spacing.4` | 16px | `p-4` / `m-4` / `gap-4` | `spacing/4` |
| `primitives.spacing.5` | 20px | `p-5` / `m-5` / `gap-5` | `spacing/5` |
| `primitives.spacing.6` | 24px | `p-6` / `m-6` / `gap-6` | `spacing/6` |
| `primitives.spacing.8` | 32px | `p-8` / `m-8` / `gap-8` | `spacing/8` |
| `primitives.spacing.10` | 40px | `p-10` / `m-10` / `gap-10` | `spacing/10` |
| `primitives.spacing.12` | 48px | `p-12` / `m-12` / `gap-12` | `spacing/12` |
| `primitives.spacing.16` | 64px | `p-16` / `m-16` / `gap-16` | `spacing/16` |
| `primitives.spacing.20` | 80px | `p-20` / `m-20` / `gap-20` | `spacing/20` |
| `primitives.spacing.24` | 96px | `p-24` / `m-24` / `gap-24` | `spacing/24` |

## Breakpoints

| Token Path | Value | Tailwind Prefix | Figma Frame |
|------------|-------|-----------------|-------------|
| `primitives.breakpoints.sm` | 640px | `sm:` | `Frame / SM (640)` |
| `primitives.breakpoints.md` | 768px | `md:` | `Frame / MD (768)` |
| `primitives.breakpoints.lg` | 1024px | `lg:` | `Frame / LG (1024)` |
| `primitives.breakpoints.xl` | 1280px | `xl:` | `Frame / XL (1280)` |
| `primitives.breakpoints.2xl` | 1536px | `2xl:` | `Frame / 2XL (1536)` |
