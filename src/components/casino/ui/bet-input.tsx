import type { ChangeEvent, InputHTMLAttributes } from "react";

type BetInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  label: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  suffix?: string;
};

export function BetInput({
  className = "",
  label,
  onChange,
  suffix,
  ...props
}: BetInputProps) {
  return (
    <label className="block w-full">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="relative block">
        <input
          className={`h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#4a86f5] ${suffix ? "pr-12" : ""} ${className}`}
          onChange={(event) => onChange?.(event.target.value, event)}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-300">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}
