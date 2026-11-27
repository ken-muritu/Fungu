"use client";
import dynamic from "next/dynamic";

// The app keeps the wallet key in this browser only, so it renders on the client.
const FunguApp = dynamic(() => import("@/components/FunguApp"), { ssr: false, loading: () => <p className="app small">Loading Fungu…</p> });

export default function AppPage() {
  return <FunguApp />;
}
