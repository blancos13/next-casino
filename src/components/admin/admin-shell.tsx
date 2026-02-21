"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { getCasinoBridge, toWsError } from "../casino/state/casino-bridge";

type AdminShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

type MenuGroup = {
  section?: string;
  items: Array<{ href: string; label: string }>;
};

const bridge = getCasinoBridge();

const MENU: MenuGroup[] = [
  {
    items: [{ href: "/admin", label: "Statistics" }],
  },
  {
    section: "Site management",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/bonus", label: "Bonuses" },
      { href: "/admin/promo", label: "Promocode" },
      { href: "/admin/settings", label: "Settings" },
      { href: "/admin/withdraws", label: "Withdraws" },
    ],
  },
  {
    section: "Chat management",
    items: [{ href: "/admin/filter", label: "Word filter" }],
  },
];

const isLinkActive = (pathname: string, href: string): boolean => {
  if (pathname === href) {
    return true;
  }
  if (pathname.startsWith(`${href}/`)) {
    return true;
  }
  if (href === "/admin/users" && pathname.startsWith("/admin/user/")) {
    return true;
  }
  return false;
};

export function AdminShell({ title, subtitle, children }: AdminShellProps) {
  const pathname = usePathname();
  const bridgeState = useSyncExternalStore(bridge.subscribeStore, bridge.getState, bridge.getServerSnapshot);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authStatus, setAuthStatus] = useState("");

  useEffect(() => {
    if (!bridgeState.isAuthenticated) {
      return;
    }
    setLoginPassword("");
    setAuthStatus("");
  }, [bridgeState.isAuthenticated]);

  const handleLogin = async (): Promise<void> => {
    if (isAuthSubmitting) {
      return;
    }
    const username = loginUsername.trim();
    const password = loginPassword.trim();
    if (!username || !password) {
      setAuthStatus("Enter username and password.");
      return;
    }
    setIsAuthSubmitting(true);
    setAuthStatus("");
    try {
      await bridge.login({ username, password });
      await bridge.ensureReady();
      setAuthStatus("");
    } catch (error) {
      setAuthStatus(toWsError(error).message);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  return (
    <div className="kt-grid kt-grid--hor kt-grid--root admin-kt-root">
      <div className="kt-grid__item kt-grid__item--fluid kt-grid kt-grid--ver kt-page">
        <button className="kt-aside-close" id="kt_aside_close_btn" type="button">
          <i className="la la-close" />
        </button>

        <div className="kt-aside kt-aside--fixed kt-grid__item kt-grid kt-grid--desktop kt-grid--hor-desktop" id="kt_aside">
          <div className="kt-aside__brand kt-grid__item" id="kt_aside_brand">
            <div className="kt-aside__brand-logo">
              <Link href="/admin">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="Win2x Admin" src="/dash/img/logo-light.png" />
              </Link>
            </div>
          </div>

          <div className="kt-aside-menu-wrapper kt-grid__item kt-grid__item--fluid" id="kt_aside_menu_wrapper">
            <div className="kt-aside-menu" data-ktmenu-dropdown-timeout="500" data-ktmenu-scroll="1" data-ktmenu-vertical="1" id="kt_aside_menu">
              <ul className="kt-menu__nav">
                {MENU.map((group) => (
                  <Fragment key={group.section ?? "main"}>
                    {group.section ? (
                      <li className="kt-menu__section">
                        <h4 className="kt-menu__section-text">{group.section}</h4>
                        <i className="kt-menu__section-icon flaticon-more-v2" />
                      </li>
                    ) : null}
                    {group.items.map((item) => (
                      <li className={`kt-menu__item ${isLinkActive(pathname, item.href) ? "kt-menu__item--active" : ""}`} key={item.href}>
                        <Link className="kt-menu__link" href={item.href}>
                          <span className="kt-menu__link-text">{item.label}</span>
                        </Link>
                      </li>
                    ))}
                  </Fragment>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="kt-grid__item kt-grid__item--fluid kt-grid kt-grid--hor kt-wrapper" id="kt_wrapper">
          <div className="kt-header kt-grid__item kt-header--fixed" id="kt_header">
            <div className="kt-header__topbar">
              {bridgeState.isAuthenticated ? (
                <div className="kt-header__topbar-item kt-header__topbar-item--user">
                  <div className="kt-header__topbar-wrapper">
                    <div className="kt-header__topbar-user">
                      <span className="kt-header__topbar-welcome kt-hidden-mobile">Hello,</span>
                      <span className="kt-header__topbar-username kt-hidden-mobile">{bridgeState.username || "Admin"}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="kt-header__topbar-item">
                    <input
                      className="form-control form-control-sm admin-top-input"
                      onChange={(event) => setLoginUsername(event.target.value)}
                      placeholder="Username"
                      type="text"
                      value={loginUsername}
                    />
                  </div>
                  <div className="kt-header__topbar-item">
                    <input
                      className="form-control form-control-sm admin-top-input"
                      onChange={(event) => setLoginPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleLogin();
                        }
                      }}
                      placeholder="Password"
                      type="password"
                      value={loginPassword}
                    />
                  </div>
                </>
              )}
              <div className="kt-header__topbar-item">
                <span className={`admin-conn-badge admin-conn-badge--${bridgeState.connection}`}>
                  WS: {bridgeState.connection.toUpperCase()}
                </span>
              </div>
              {bridgeState.isAuthenticated ? (
                <div className="kt-header__topbar-item">
                  <button className="btn btn-label-brand btn-sm btn-bold" onClick={() => void bridge.logout()} type="button">
                    Logout
                  </button>
                </div>
              ) : (
                <div className="kt-header__topbar-item">
                  <button className="btn btn-label-brand btn-sm btn-bold" disabled={isAuthSubmitting} onClick={() => void handleLogin()} type="button">
                    {isAuthSubmitting ? "..." : "Login"}
                  </button>
                </div>
              )}
              {authStatus ? (
                <div className="kt-header__topbar-item">
                  <span className="admin-auth-status">{authStatus}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="kt-grid__item kt-grid__item--fluid kt-grid kt-grid--hor">
            <div className="kt-subheader kt-grid__item" id="kt_subheader">
              <div className="kt-subheader__main">
                <h3 className="kt-subheader__title">{title}</h3>
              </div>
            </div>
            <div className="kt-content kt-grid__item kt-grid__item--fluid" id="kt_content">
              {subtitle ? <div className="admin-subtitle">{subtitle}</div> : null}
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
