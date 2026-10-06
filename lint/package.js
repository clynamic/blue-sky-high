const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = require(path.join(root, "manifest.json"));

const failures = [];

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function builtArtifact() {
  const dir = path.join(root, "web-ext-artifacts");
  execFileSync("npx", ["web-ext", "build", "--overwrite-dest"], { cwd: root, stdio: "ignore" });
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".zip"))
    .map((name) => path.join(dir, name))
    .toSorted((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function packagedFiles(artifact) {
  return execFileSync("unzip", ["-Z1", artifact])
    .toString()
    .split("\n")
    .filter((name) => name && !name.endsWith("/"));
}

function filesNamedInManifest() {
  const named = new Set(["manifest.json", "README.md", "LICENSE"]);
  Object.values(manifest.icons).forEach((icon) => named.add(icon));
  manifest.declarative_net_request.rule_resources.forEach((ruleset) => named.add(ruleset.path));
  manifest.content_scripts.forEach((script) => script.js.forEach((file) => named.add(file)));
  return named;
}

const artifact = builtArtifact();
const packaged = packagedFiles(artifact);
const named = filesNamedInManifest();
for (const file of packaged) {
  expect(named.has(file), `${file} is packaged but not named in the manifest`);
  const bytesInPackage = execFileSync("unzip", ["-p", artifact, file]);
  expect(
    bytesInPackage.equals(fs.readFileSync(path.join(root, file))),
    `${file} differs between the package and the tree`,
  );
}
for (const file of named) {
  expect(packaged.includes(file), `${file} is named in the manifest but not packaged`);
}

console.log(`${packaged.length} files packaged from ${path.basename(artifact)}`);
for (const failure of failures) {
  console.log(`FAIL  ${failure}`);
}
console.log(failures.length ? "package check failed" : "package check passed");
process.exit(failures.length ? 1 : 0);
