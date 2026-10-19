// Starts the loanbook and/or the two referees.
//   ts-node src/serve.ts all [--fresh]       loanbook + referee A + referee B
//   ts-node src/serve.ts loanbook|refereeA|refereeB
// --fresh deletes the loanbook database first (one loan per stack run in the demo).
import { existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { LOANBOOK_PORT, LOANBOOK_URL } from "./config";
import { LoanbookClient, serveLoanbook } from "./loanbook";
import { startReferee } from "./referee";

const what = process.argv[2] ?? "all";
const db = process.env.HYPOTHEC_LOANBOOK_DB ?? join(homedir(), ".hypothec", "loanbook.sqlite");

if (what === "all" || what === "loanbook") {
  mkdirSync(join(homedir(), ".hypothec"), { recursive: true });
  if (process.argv.includes("--fresh") && existsSync(db)) rmSync(db);
  serveLoanbook(LOANBOOK_PORT, db);
  console.log(`[loanbook] ${LOANBOOK_URL} (${db})`);
}
const loanbook = new LoanbookClient(LOANBOOK_URL);
if (what === "all" || what === "refereeA") startReferee("refereeA", loanbook);
if (what === "all" || what === "refereeB") startReferee("refereeB", loanbook);
