import { redirect } from "next/navigation";

/** The app lives under /burnticker (the static receipts site is served at / by Caddy in production). */
export default function Home() {
  redirect("/burnticker");
}
