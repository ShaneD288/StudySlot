// Downloads the undergraduate (CAO) course lists for Dublin's universities and writes
// public/courses.json: { "TR": [["TR033", "Computer Science"], ...], ... }.
// Run with: node scripts/fetch-courses.js   (re-run each year when CAO publishes new courses)
import fs from "node:fs";

const COLLEGES = {
  TR: "Trinity College Dublin",
  DN: "University College Dublin",
  DC: "Dublin City University",
  TU: "TU Dublin",
  RC: "RCSI",
};

const decode = (s) =>
  s
    .replace(/`/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ")
    .trim();

const out = {};
for (const [code, name] of Object.entries(COLLEGES)) {
  const res = await fetch("https://www.cao.ie/courses.php?bb=courses", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Studyslot course list)",
    },
    body: new URLSearchParams({ flag: "hei", college: code, url: code }),
  });
  const html = await res.text();
  const seen = new Map();
  for (const m of html.matchAll(new RegExp(`<u>(${code}\\d{3})</u></b></a>([^<]+)`, "g"))) {
    const title = decode(m[2]).replace(/\s*\[[^\]]*\]\s*$/, ""); // drop "[Interview]" etc.
    if (title && !seen.has(m[1])) seen.set(m[1], title);
  }
  out[code] = [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  console.log(`${code} ${name}: ${out[code].length} courses`);
}
fs.writeFileSync("public/courses.json", JSON.stringify(out));
console.log("wrote public/courses.json", (fs.statSync("public/courses.json").size / 1024).toFixed(1), "KB");
