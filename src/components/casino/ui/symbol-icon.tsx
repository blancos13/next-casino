type SymbolIconProps = {
  className?: string;
  id: string;
};

export function SymbolIcon({ className = "", id }: SymbolIconProps) {
  return (
    <svg aria-hidden="true" className={className} focusable="false">
      <use xlinkHref={`/img/symbols.svg#${id}`} />
    </svg>
  );
}
