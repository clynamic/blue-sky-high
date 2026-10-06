const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "media-source.js"), "utf8");
const blobUrl =
  "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:artist&cid=bafyimage";

function mediaElement(currentSrc) {
  const element = { currentSrc, steps: [] };
  Object.defineProperty(element, "src", {
    get: () => element.currentSrc,
    set: (value) => {
      element.steps.push(`set ${value}`);
      element.currentSrc = value;
    },
  });
  element.removeAttribute = (name) => element.steps.push(`remove ${name}`);
  return element;
}

function loadDocument({ url, image, video }) {
  vm.runInNewContext(script, {
    location: { href: url },
    document: { images: image ? [image] : [], querySelector: () => video ?? null },
  });
}

test("reloads the shown image from the document URL when it was requested as the sample", () => {
  const image = mediaElement(
    "https://cdn.example/img/feed_fullsize/plain/did:plc:artist/bafyimage@jpeg",
  );
  loadDocument({ url: blobUrl, image });
  assert.deepEqual(image.steps, ["remove src", `set ${blobUrl}`]);
  assert.equal(image.currentSrc, blobUrl);
});

test("leaves the shown image alone when its current source is the document URL", () => {
  const image = mediaElement(blobUrl);
  loadDocument({ url: blobUrl, image });
  assert.deepEqual(image.steps, []);
});

test("reloads the shown video the same way", () => {
  const video = mediaElement(
    "https://video.example/watch/did%3Aplc%3Aartist/bafyvideo/playlist.m3u8",
  );
  loadDocument({ url: blobUrl, video });
  assert.deepEqual(video.steps, ["remove src", `set ${blobUrl}`]);
});

test("does nothing on a document without an image or a video", () => {
  assert.doesNotThrow(() => loadDocument({ url: blobUrl }));
});
