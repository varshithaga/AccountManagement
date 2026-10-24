interface LogoProps {
  size?: number
  className?: string
}

/** The LedgerDesk mark drawn in the current text colour: a ledger "L" (left rule + base line) with
 * two entry lines and an amber dot. Sits inside the brand tile (bg-primary text-on-primary). */
export function LogoMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6.5 4.5V19.5H18.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 10H16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.5 14.5H14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <circle cx="17.5" cy="5.5" r="2" fill="var(--highlight)" />
    </svg>
  )
}

export default function Logo({ size = 36, className = '' }: LogoProps) {
  return (
    <img
      src="/logo.svg"
      alt="LedgerDesk Logo"
      style={{ width: size, height: size }}
      className={`block shrink-0 object-contain transition-transform duration-200 hover:scale-105 ${className}`}
    />
  )
}
