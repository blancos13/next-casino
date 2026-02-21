import type { GameHistoryRow } from "../types";

type GameHistoryTableProps = {
  rows: GameHistoryRow[];
  title?: string;
};

export function GameHistoryTable({ rows, title = "Game Bets" }: GameHistoryTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_20px_30px_rgba(0,0,0,0.25)]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="font-display text-lg font-bold text-white">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1f2737]/80 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Bet</th>
              <th className="px-4 py-3 font-semibold">Roll</th>
              <th className="px-4 py-3 font-semibold">Rate</th>
              <th className="px-4 py-3 font-semibold">Chance</th>
              <th className="px-4 py-3 font-semibold">Win</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-white/10" key={row.id}>
                <td className="px-4 py-3 font-semibold text-slate-200">{row.user}</td>
                <td className="px-4 py-3 text-slate-100">${row.bet.toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-100">{row.roll.toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-100">x{row.multiplier.toFixed(2)}</td>
                <td className="px-4 py-3 text-slate-100">{row.chance.toFixed(2)}%</td>
                <td
                  className={`px-4 py-3 font-semibold ${row.win ? "text-[#7ee27a]" : "text-[#ff899c]"}`}
                >
                  {row.win ? "+" : "-"}${Math.abs(row.result).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
