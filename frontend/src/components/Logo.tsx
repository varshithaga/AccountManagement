interface LogoProps {
  size?: number
  className?: string
}

export default function Logo({ size = 36, className = '' }: LogoProps) {
  return (
    <img
      src="/logo.svg"
      alt="Ledgerline Logo"
      style={{ width: size, height: size }}
      className={`block shrink-0 object-contain transition-transform duration-200 hover:scale-105 ${className}`}
    />
  )
}

