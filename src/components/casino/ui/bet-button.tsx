import type { ButtonHTMLAttributes, ReactNode } from "react";

type BetButtonVariant = "primary" | "secondary" | "success" | "ghost";
type BetButtonSize = "sm" | "md" | "lg";

type BetButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fullWidth?: boolean;
  size?: BetButtonSize;
  variant?: BetButtonVariant;
};

const variantClassMap: Record<BetButtonVariant, string> = {
  ghost:
    "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
  primary:
    "bg-[#4a86f5] text-white hover:bg-[#2d72ef]",
  secondary:
    "border border-white/10 bg-[#2a3240] text-slate-100 hover:bg-[#343f50]",
  success:
    "bg-[#5fc95b] text-[#10200f] hover:bg-[#72d66e]",
};

const sizeClassMap: Record<BetButtonSize, string> = {
  lg: "h-12 px-5 text-sm font-semibold",
  md: "h-10 px-4 text-sm font-semibold",
  sm: "h-8 px-3 text-xs font-semibold",
};

export function BetButton({
  children,
  className = "",
  fullWidth = false,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: BetButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-xl transition ${sizeClassMap[size]} ${variantClassMap[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
