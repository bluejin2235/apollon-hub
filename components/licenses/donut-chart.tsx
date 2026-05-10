"use client";

type Slice = { label: string; value: number; color: string };

export default function DonutChart({ slices, size = 160 }: { slices: Slice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0 || slices.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-500"
        style={{ width: size, height: size }}
      >
        데이터 없음
      </div>
    );
  }

  let acc = 0;
  const gradientParts = slices.map((sl) => {
    const start = (acc / total) * 100;
    acc += sl.value;
    const end = (acc / total) * 100;
    return `${sl.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });

  const style = {
    width: size,
    height: size,
    background: `conic-gradient(${gradientParts.join(", ")})`
  };

  const hole = size * 0.56;

  return (
    <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
      <div className="relative shrink-0" style={style}>
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[inset_0_0_0_1px_rgb(226_232_240)]"
          style={{ width: hole, height: hole }}
        />
      </div>
      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {slices.map((sl) => (
          <li key={sl.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: sl.color }} />
              <span className="truncate text-slate-800">{sl.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-600">
              {((sl.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
