const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = require(path.join(root, "manifest.json"));
const codeFiles = [
  "manifest.json",
  "rules.json",
  ...manifest.content_scripts.flatMap((script) => script.js),
];
const allowedHosts = new Set([
  "https://bsky.app",
  "https://cdn.bsky.app",
  "https://video.bsky.app",
  "https://bsky.social",
  "https://*.bsky.network",
  "https://public.api.bsky.app",
]);
const forbidden =
  /\beval\(|\bFunction\(|innerHTML|import\(|setTimeout\(\s*["'`]|createElement\(\s*["'`]script/;

const failures = [];

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function hostsIn(text) {
  return [...text.matchAll(/https:\/\/[A-Za-z0-9*.\\-]+/g)].map((match) =>
    match[0].replace(/\\/g, ""),
  );
}

let totalLines = 0;
for (const file of codeFiles) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const lines = text.split("\n").filter(Boolean).length;
  totalLines += lines;
  expect(lines < 100, `${file} has ${lines} lines, the limit is 100`);
  expect(!forbidden.test(text), `${file} contains a construct the readability criteria forbid`);
  for (const host of hostsIn(text)) {
    expect(allowedHosts.has(host), `${file} names ${host}, which is not an allowed host`);
  }
}
expect(totalLines < 200, `the code files total ${totalLines} lines, the limit is 200`);
expect(!("content_security_policy" in manifest), "the manifest sets a content_security_policy");

console.log(`${codeFiles.length} code files, ${totalLines} lines`);
for (const failure of failures) {
  console.log(`FAIL  ${failure}`);
}
console.log(failures.length ? "code check failed" : "code check passed");
process.exit(failures.length ? 1 : 0);
