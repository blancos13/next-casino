"use client";

import { useEffect } from "react";

const ADMIN_BODY_CLASSES = [
  "kt-header--fixed",
  "kt-header-mobile--fixed",
  "kt-subheader--fixed",
  "kt-subheader--enabled",
  "kt-subheader--solid",
  "kt-aside--enabled",
  "kt-aside--fixed",
];

export function AdminBodyClass() {
  useEffect(() => {
    const body = document.body;
    body.classList.remove("kt-page--loading");
    ADMIN_BODY_CLASSES.forEach((name) => body.classList.add(name));

    return () => {
      body.classList.remove("kt-page--loading");
      ADMIN_BODY_CLASSES.forEach((name) => body.classList.remove(name));
    };
  }, []);

  return null;
}
