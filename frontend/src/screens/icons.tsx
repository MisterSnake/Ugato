// Inline icons, sized in em. They are decorative: the text next to them says
// what they mean. Emoji would look different on every platform.
import { useId } from 'react'
import type { ReactNode } from 'react'

interface IconProps {
  className?: string
}

function Icon({
  className,
  gradient,
  children,
}: IconProps & {
  /** Filled with the theme's gradient instead of the text color. */
  gradient?: boolean
  children: ReactNode
}) {
  // Each gradient needs an id of its own.
  const id = useId()

  return (
    <svg
      aria-hidden="true"
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill={gradient ? `url(#${id})` : 'currentColor'}
    >
      {gradient && (
        <linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
        >
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      )}
      {children}
    </svg>
  )
}

export function GamepadIcon(props: IconProps) {
  return (
    <Icon gradient {...props}>
      <path
        fillRule="evenodd"
        d="M7 6h10a6 6 0 0 1 6 6l.4 4.2a2.8 2.8 0 0 1-4.8 2.3L16 16H8l-2.6 2.5a2.8 2.8 0 0 1-4.8-2.3L1 12a6 6 0 0 1 6-6ZM6.2 8.5v2H4.2v1.8h2v2H8v-2h2v-1.8H8v-2ZM15.8 9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm2.8 2.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"
      />
    </Icon>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fillRule="evenodd"
        d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm2.2 0h5.6V7a2.8 2.8 0 0 0-5.6 0ZM12 13.5a1.8 1.8 0 0 0-.9 3.4V19h1.8v-2.1a1.8 1.8 0 0 0-.9-3.4Z"
      />
    </Icon>
  )
}

export function PaletteIcon(props: IconProps) {
  return (
    <Icon gradient {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20c1.4 0 2.2-1 2.2-2.100 0-1.2-.9-1.600-.9-2.7 0-1 .8-1.700 1.9-1.700H18a4 4 0 0 0 4-4C22 6.100 17.5 2 12 2ZM6.5 10.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2ZM9 5.8A1.6 1.6 0 1 0 9 9a1.6 1.6 0 0 0 0-3.2Zm6 0A1.6 1.6 0 1 0 15 9a1.6 1.6 0 0 0 0-3.2Zm3 4.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"
      />
    </Icon>
  )
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="7.5" r="3.5" />
      <circle cx="4.5" cy="9.5" r="2.5" />
      <circle cx="19.5" cy="9.5" r="2.5" />
      <path d="M6 19c0-3.5 2.7-6 6-6s6 2.5 6 6v1H6ZM0 18c0-3 2-5 4.500-5 .8 0 1.600.2 2.2.600A8 8 0 0 0 4.5 19H0Zm24 0c0-3-2-5-4.5-5-.8 0-1.6.2-2.2.6a8 8 0 0 1 2.2 5.4H24Z" />
    </Icon>
  )
}

export function GridIcon(props: IconProps) {
  return (
    <Icon gradient {...props}>
      {[2, 9, 16].flatMap((y) =>
        [2, 9, 16].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" />
        )),
      )}
    </Icon>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 4.5h2.4v5l3.6 2.2-1.2 2-4.8-2.9Z"
      />
    </Icon>
  )
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="7" r="4.5" />
      <path d="M3.5 20c0-4.4 3.8-7 8.500-7s8.500 2.600 8.500 7v1.5h-17Z" />
    </Icon>
  )
}
