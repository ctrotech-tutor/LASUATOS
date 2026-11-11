export function BrandMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B" />
      <path
        d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35"
        stroke="#F7F8F4"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M18.5 35V25h12v10" stroke="#F7F8F4" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C" />
    </svg>
  );
}
