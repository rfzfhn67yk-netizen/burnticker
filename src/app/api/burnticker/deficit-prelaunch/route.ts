import { NextResponse } from "next/server";
import { deficitPrelaunch } from "@/lib/burnticker/deficitPrelaunch";

export const dynamic = "force-dynamic";

/** The $DEFICIT pre-launch page's data (src/lib/burnticker/deficitPrelaunch.ts): the locked rules file + config/burnticker/current-status.json. */
export async function GET() {
  try { return NextResponse.json(deficitPrelaunch(), { headers: { "cache-control": "public, max-age=300" } }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
