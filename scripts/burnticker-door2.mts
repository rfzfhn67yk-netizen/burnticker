// Writes the landing page's Seasons door from the leagues index (src/lib/burnticker/landingDoors.ts). Run after a league is added:
//   node --import ./test/alias-hook.mjs scripts/burnticker-door2.mts
import fs from "node:fs";
import { withDoor2 } from "@/lib/burnticker/landingDoors";
const file = "site/burnticker/index.html";
fs.writeFileSync(file, withDoor2(fs.readFileSync(file, "utf8")));
console.log(`${file}: door 2 written from the leagues index`);
