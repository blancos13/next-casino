"use client";

import { useSyncExternalStore } from "react";
import { getToastStore } from "../state/toast-store";

const toastStore = getToastStore();

const ICON_ERROR =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjciIGhlaWdodD0iMjciIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE5LjY0IDUuNmwtLjA4LjA4TDYgMTkuMjRjLS4xNi4xNi0uMjcuMy0uMzUuNDRhMTAuMSAxMC4xIDAgMCAxLTIuMDctNi4yMiA5LjcgOS43IDAgMCAxIDkuODgtOS45MmMyLjM3IDAgNC41Ljc2IDYuMTggMi4wNnpNNy43IDIxLjY0Yy4xMi0uMDcuMjUtLjE4LjM5LS4zMkwyMS42NCA3Ljc2bC4wMi0uMDNhMTAuMDYgMTAuMDYgMCAwIDEgMS43NiA1Ljc3YzAgNS42My00LjI5IDkuOTYtOS45MiA5Ljk2YTkuOSA5LjkgMCAwIDEtNS44MS0xLjgyek0xIDEzLjVhMTIuNSAxMi41IDAgMSAwIDI1IDAgMTIuNSAxMi41IDAgMCAwLTI1IDB6IiBzdHJva2U9IiNmMTAyNjAiIGZpbGw9IiNmMTAyNjAiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPjwvc3ZnPg==";
const ICON_SUCCESS =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjIiIGhlaWdodD0iMTciIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTS4zNiA3LjljLS41LjUzLS40NyAxLjU3LjAzIDIuMDhsNi4wMyA2LjEyYy41MS41MiAxLjUzLjUzIDIuMDUuMDRsLjk2LS45MiAyLjA4LTJMMjEuNiAzLjZjLjUyLS41LjU0LTEuNTEuMDMtMi4wMkwyMC40Ni4zOGMtLjUxLS41LTEuNTMtLjUtMi4wNC0uMDFsLTkuODcgOS44NmMtLjUuNS0xLjUyLjUtMi4wMi0uMDJMMy4yNCA2LjljLS40OS0uNTItMS40OC0uNS0xLjk3LjAzbC0uOTEuOTd6IiBmaWxsPSIjOTZDNzczIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=";
const ICON_INFO =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB3aWR0aD0iMjciIGhlaWdodD0iMjciIHZpZXdCb3g9IjAgMCAzMzAgMzMwIj48Zz48cGF0aCBkPSJNMTY1IDBDNzQuMDE5IDAgMCA3NC4wMiAwIDE2NS4wMDFDMCAyNTUuOTgyIDc0LjAxOSAzMzAgMTY1IDMzMHMxNjUtNzQuMDE4IDE2NS0xNjQuOTk5QzMzMCA3NC4wMiAyNTUuOTgxIDAgMTY1IDB6bTAgMzAwYy03NC40NCAwLTEzNS02MC41Ni0xMzUtMTM0Ljk5OUMzMCA5MC41NjIgOTAuNTYgMzAgMTY1IDMwczEzNSA2MC41NjIgMTM1IDEzNS4wMDFDMzAwIDIzOS40NCAyMzkuNDM5IDMwMCAxNjUgMzAweiIgZmlsbD0iIzAwOTFGRiIvPjxwYXRoIGQ9Ik0xNjQuOTk4IDcwYy0xMS4wMjYgMC0xOS45OTYgOC45NzYtMTkuOTk2IDIwLjAwOXM4Ljk3IDE5Ljk5MSAxOS45OTYgMTkuOTkxYzExLjAyNiAwIDE5Ljk5Ni04Ljk2OCAxOS45OTYtMTkuOTkxUzE3Ni4wMjQgNzAgMTY0Ljk5OCA3MHoiIGZpbGw9IiMwMDkxRkYiLz48cGF0aCBkPSJNMTY1IDE0MGMtOC4yODQgMC0xNSA2LjcxNi0xNSAxNXY5MGMwIDguMjg0IDYuNzE2IDE1IDE1IDE1czE1LTYuNzE2IDE1LTE1di05MGMwLTguMjg0LTYuNzE2LTE1LTE1LTE1eiIgZmlsbD0iIzAwOTFGRiIvPjwvZz48L3N2Zz4=";

const TOAST_META = {
  error: { title: "Error", icon: ICON_ERROR },
  success: { title: "Successfully", icon: ICON_SUCCESS },
  warning: { title: "Attention", icon: ICON_INFO },
  info: { title: "Information", icon: ICON_INFO },
} as const;

export function ToastLayer() {
  const toastState = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    toastStore.getServerSnapshot,
  );

  if (toastState.items.length === 0) {
    return null;
  }

  return (
    <div className="notify">
      {toastState.items.map((item, index) => {
        const meta = TOAST_META[item.type];
        return (
          <div
            className={`notify__item ${item.type} show`}
            key={item.id}
            style={{ top: `${index * 62}px` }}
          >
            <div className="notify__item-wrap">
              <div className="notify__aside">
                <img alt="" src={meta.icon} />
              </div>
              <div className="notify__title">{meta.title}</div>
              <div className="notify__message">{item.message}</div>
              <button
                className="notify__close"
                onClick={() => toastStore.dismiss(item.id)}
                type="button"
              >
                x
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
