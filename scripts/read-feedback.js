// Prints the messages sent from the app's feedback form, newest first.
//   npm run feedback                  from the live site
//   npm run feedback -- --id <id>     if you have more than one feedback store
//   npm run feedback -- --local       from `npm run dev` (add --persist-to <dir> if dev uses one)
// Needs `npx wrangler login`. Messages delete themselves a year after they're sent.
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const wrangler = (command) =>
  execSync(`npx wrangler ${command}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let where;
if (args.includes("--local")) {
  const persist = args.includes("--persist-to") ? ` --persist-to "${args[args.indexOf("--persist-to") + 1]}"` : "";
  where = `--binding FEEDBACK --local${persist}`;
} else {
  let id = args[args.indexOf("--id") + 1];
  if (!args.includes("--id")) {
    // Wrangler made the store on the first deploy; find it by name.
    const stores = JSON.parse(wrangler("kv namespace list")).filter((n) => /feedback/i.test(n.title));
    if (stores.length !== 1) {
      console.error(
        stores.length
          ? `More than one feedback store. Pick one with --id:\n${stores.map((n) => `  ${n.id}  ${n.title}`).join("\n")}`
          : "No feedback store yet. It's created the first time you deploy (npm run deploy).",
      );
      process.exit(1);
    }
    id = stores[0].id;
  }
  where = `--namespace-id ${id} --remote`;
}

const keys = JSON.parse(wrangler(`kv key list ${where}`))
  .map((k) => k.name)
  .sort()
  .reverse();
if (!keys.length) {
  console.log("No feedback yet.");
  process.exit(0);
}

const LABELS = { bug: "Something's wrong", idea: "Idea", other: "Other" };
for (const key of keys) {
  let entry;
  try {
    entry = JSON.parse(wrangler(`kv key get "${key}" ${where} --text`));
  } catch {
    continue; // deleted or expired since the list was made
  }
  const when = new Date(entry.at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" });
  console.log(`\n${when} · ${LABELS[entry.kind] || entry.kind} · ${entry.device} · v${entry.version}`);
  if (entry.email) console.log(`Reply to: ${entry.email}`);
  console.log(entry.message);
}
console.log(`\n${keys.length} message${keys.length === 1 ? "" : "s"}.`);
