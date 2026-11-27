/** The Fungu mark: a ring filling up, a portion paid down ("fungu" means share, portion, installment). */
export function Ring({ value = 0.66, size = 26, stroke = 4 }: { value?: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e6ec" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v >= 1 ? "#1f8a5b" : "#e8a33d"} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

export function Logo() {
  return (
    <a href="/" className="brand" aria-label="Fungu home">
      <Ring value={0.7} size={26} stroke={4.5} />
      fungu
    </a>
  );
}
