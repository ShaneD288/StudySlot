// Runs before `npm run deploy`: stops a launch with unfilled legal placeholders.
import fs from "node:fs";

const problems = [];
for (const file of ["public/privacy.html", "public/terms.html"]) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("[Your name]")) problems.push(`${file}: replace "[Your name]" with the name of the person running Studyslot.`);
}
if (problems.length) {
  console.error("\nNot ready to launch:\n  " + problems.join("\n  ") + "\n");
  process.exit(1);
}
console.log("Launch checks passed. Make sure hello@studyslot.ie receives email before sharing the app.");
