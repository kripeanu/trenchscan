export function TrenchMark({ size = 42 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="trench-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
    >
      <defs>
        <linearGradient id="trench-glow" x1="10" y1="8" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#39F7D4" />
          <stop offset="0.58" stopColor="#19E7B1" />
          <stop offset="1" stopColor="#7CFFB2" />
        </linearGradient>
      </defs>

      <path
        d="M32 4.5v7M32 52.5v7M4.5 32h7M52.5 32h7"
        stroke="url(#trench-glow)"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      <path
        d="M19.2 9.9A25.1 25.1 0 0 0 9.8 19M54.2 19A25.1 25.1 0 0 0 44.8 9.9M9.8 45a25.1 25.1 0 0 0 9.4 9.1M44.8 54.1a25.1 25.1 0 0 0 9.4-9.1"
        stroke="url(#trench-glow)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity=".9"
      />
      <path
        d="M32 12 18.2 22.4l-5.5 15.8 10.9 11.4L32 54l8.4-4.4 10.9-11.4-5.5-15.8L32 12Z"
        fill="#07100D"
        stroke="url(#trench-glow)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M32 13.7 21.2 23l4.6 8.2 6.2-4.6 6.2 4.6 4.6-8.2L32 13.7Z"
        fill="url(#trench-glow)"
        opacity=".92"
      />
      <path
        d="m20.9 33.4 8.6 3.1-4.9 4.2-5.8-2.2 2.1-5.1Zm22.2 0-8.6 3.1 4.9 4.2 5.8-2.2-2.1-5.1Z"
        fill="#5BFFD0"
      />
      <path
        d="M25.5 43.4 32 39.5l6.5 3.9-2.2 6-4.3 2.2-4.3-2.2-2.2-6Z"
        fill="#0F5E49"
        stroke="#32F5C5"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M32 17v8.5" stroke="#07100D" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function TrenchBrand() {
  return (
    <div className="brand-lockup" aria-label="TrenchScan">
      <TrenchMark />
      <div className="brand-copy">
        <div className="brand-name">
          <span>Trench</span>
          <strong>Scan</strong>
        </div>
        <span className="brand-line">FRESH TRENCHES. LESS BULLSHIT.</span>
      </div>
    </div>
  );
}
