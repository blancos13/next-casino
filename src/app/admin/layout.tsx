import type { ReactNode } from "react";
import Script from "next/script";
import { AdminBodyClass } from "@/components/admin/admin-body-class";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <link
        crossOrigin="anonymous"
        href="https://use.fontawesome.com/releases/v5.8.1/css/all.css"
        integrity="sha384-50oBUHEmvpQ+1lW4y57PTFmhCaXp0ML5d60M1M7uH2+nqUivzIebhndOJK28anvf"
        rel="stylesheet"
      />
      <link href="/dash/css/perfect-scrollbar.css" rel="stylesheet" type="text/css" />
      <link href="/dash/css/line-awesome.css" rel="stylesheet" type="text/css" />
      <link href="/dash/css/flaticon.css" rel="stylesheet" type="text/css" />
      <link href="/dash/css/flaticon2.css" rel="stylesheet" type="text/css" />
      <link href="/dash/css/style.bundle.css" rel="stylesheet" type="text/css" />
      <link href="/dash/css/datatables.bundle.min.css" rel="stylesheet" type="text/css" />
      <link href="/css/notify.css" rel="stylesheet" />

      <div className="kt-header--fixed kt-subheader--fixed kt-subheader--enabled kt-subheader--solid kt-aside--enabled kt-aside--fixed">
        <AdminBodyClass />
        <Script src="/dash/js/jquery.min.js" strategy="beforeInteractive" />
        <Script src="/js/wnoty.js" strategy="beforeInteractive" />
        <Script src="/dash/js/popper.min.js" strategy="beforeInteractive" />
        <Script src="/dash/js/bootstrap.min.js" strategy="beforeInteractive" />
        <Script src="/dash/js/perfect-scrollbar.min.js" strategy="afterInteractive" />
        <Script src="/dash/js/scripts.bundle.js" strategy="afterInteractive" />
        <Script src="/dash/js/datatables.bundle.min.js" strategy="afterInteractive" />
        {children}
      </div>
    </>
  );
}
