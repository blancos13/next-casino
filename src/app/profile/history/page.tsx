"use client";

import { useState } from "react";
import { MainLayout } from "@/components/casino/layout/main-layout";

export default function ProfileHistoryPage() {
  const [tab, setTab] = useState<"with" | "dep">("with");

  return (
    <MainLayout>
      <div className="section profile-history-page">
        <div className="wallet_container">
          <div className="wallet_component">
            <div className="history_nav">
              <button className={`btn${tab === "with" ? " isActive" : ""}`} onClick={() => setTab("with")} type="button">
                <span>Withdraw history</span>
              </button>
              <button className={`btn${tab === "dep" ? " isActive" : ""}`} onClick={() => setTab("dep")} type="button">
                <span>Deposite history</span>
              </button>
            </div>

            <div className="history_wrapper with" style={{ display: tab === "with" ? "block" : "none" }}>
              <div className="withPager">
                <div className="list">
                  <div className="history_empty">
                    <h4>N/A</h4>
                    You haven&apos;t submitted yet
                  </div>
                </div>
              </div>
            </div>

            <div className="history_wrapper dep" style={{ display: tab === "dep" ? "block" : "none" }}>
              <div className="withPager">
                <div className="list">
                  <div className="history_empty">
                    <h4>N/A</h4>
                    You haven&apos;t submitted yet
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
