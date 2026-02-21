"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SymbolIcon } from "../ui/symbol-icon";

const gameItems = [
  { href: "/casino/games/crash", icon: "icon-crash", label: "Crash" },
  { href: "/casino/games/jackpot", icon: "icon-jackpot", label: "Jackpot" },
  { href: "/casino/games/wheel", icon: "icon-roulette", label: "Wheel" },
  { href: "/casino/games/coinflip", icon: "icon-flip", label: "Coinflip" },
  { href: "/casino/games/battle", icon: "icon-battle", label: "Battle" },
  { href: "/casino/games/dice", icon: "icon-dice", label: "Dice" },
];

export function GameNavbar() {
  const pathname = usePathname();

  return (
    <div className="left-sidebar">
      <Link className="logo" href="/casino/games/dice">
        <img alt="win2x" className="logotype" src="/img/logo_small.png" />
      </Link>
      <ul className="side-nav">
        {gameItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li className={isActive ? "current" : ""} key={item.href}>
              <Link href={item.href}>
                <SymbolIcon className="icon" id={item.icon} />
                <div className="side-nav-tooltip">{item.label}</div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
