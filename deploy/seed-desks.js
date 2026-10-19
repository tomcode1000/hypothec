// On a host's first boot the loanbook has no desks: open the two test desks (their agents
// answer and fund on their own, docs/DECISIONS.md D18). Does nothing once desks exist.
require("/app/services/node_modules/ts-node").register({ transpileOnly: true, project: "/app/services/tsconfig.json" });
const { loanbook, openTestDesk } = require("/app/services/src/actions");

(async () => {
  if ((await loanbook.desks()).length) return console.log("desks already open");
  const a = await openTestDesk({ name: "Desk A", aprBps: 900, maxUsdc: 3_000_000 }, "lender");
  const b = await openTestDesk({ name: "Desk B", aprBps: 1200, maxUsdc: 5_000_000 }, "lender2");
  console.log(`opened ${a.name} and ${b.name}`);
})().catch((e) => {
  console.log(`seed desks: ${e.message}`);
  process.exit(1);
});
