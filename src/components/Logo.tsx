export function PaletteMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M16 3.2C9 3.2 3.4 8.4 3.4 15.4c0 6 4.6 9.6 9 9.6 2 0 2.9-1.2 2.9-2.6 0-1.5-1.2-2-1.2-3.3 0-1 .8-1.8 1.9-1.8h2.2c4 0 7.4-2.9 7.4-7.3 0-4.3-4-6.8-9.6-6.8Z"
        fill="#F6E7DE"
        stroke="#D97757"
        strokeWidth="1.5"
      />
      <circle cx="9.4" cy="13.2" r="1.7" fill="#D97757" />
      <circle cx="13.6" cy="9.2" r="1.7" fill="#D9B25A" />
      <circle cx="19.4" cy="9.6" r="1.7" fill="#7C8BA5" />
      <circle cx="22.2" cy="14.4" r="1.7" fill="#1F1E1B" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="flex items-start gap-2.5">
      <PaletteMark size={32} />
      <div className="leading-tight">
        <div className="flex items-center gap-2">
          <span className="wordmark whitespace-nowrap text-[22px] font-medium text-ink">MDesign</span>
          <span className="whitespace-nowrap rounded-md bg-sink px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
            Research Preview
          </span>
        </div>
      </div>
    </div>
  )
}
