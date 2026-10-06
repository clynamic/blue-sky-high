const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../rules.json");

const sampleDid = "did:plc:o55tuozxhqspgx6lz4rhxopc";
const sampleCid = "bafkreiezt3vadij5ksnwj7edfderpss6jolauavs54x73euzm5yor6b46e";
const sampleBlob = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${sampleDid}&cid=${sampleCid}`;

const videoDid = "did%3Aplc%3Ana5y3i342ylztepuaf5jp2cq";
const videoCid = "bafkreichhstfi7ginpnok6kqmmhspi5luun5dawdkyxkv5uytiil2nsddy";
const videoBlob = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${videoDid}&cid=${videoCid}`;

function filterFlags(condition) {
  return condition.isUrlFilterCaseSensitive ? "" : "i";
}

function matchesCondition(condition, url) {
  const host = new URL(url).hostname;
  if (
    condition.regexFilter &&
    !new RegExp(condition.regexFilter, filterFlags(condition)).test(url)
  ) {
    return false;
  }
  if (condition.urlFilter && /[*|^]/.test(condition.urlFilter)) {
    throw new Error(
      `urlFilter ${condition.urlFilter} uses pattern syntax this simulation does not model`,
    );
  }
  if (condition.urlFilter && !url.toLowerCase().includes(condition.urlFilter.toLowerCase())) {
    return false;
  }
  if (
    condition.requestDomains &&
    !condition.requestDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ) {
    return false;
  }
  return true;
}

function redirectFor(url) {
  const rule = rules.find(
    (candidate) =>
      candidate.action.type === "redirect" && matchesCondition(candidate.condition, url),
  );
  if (!rule) {
    return null;
  }
  return url.replace(
    new RegExp(rule.condition.regexFilter, filterFlags(rule.condition)),
    rule.action.redirect.regexSubstitution.replace(/\\(\d)/g, "$$$1"),
  );
}

function responseHeadersFor(url) {
  const rule = rules.find(
    (candidate) =>
      candidate.action.type === "modifyHeaders" && matchesCondition(candidate.condition, url),
  );
  return rule ? rule.action.responseHeaders : [];
}

test("redirects a full size sample with a format suffix to the blob on bsky.social", () => {
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/feed_fullsize/plain/${sampleDid}/${sampleCid}@jpeg`),
    sampleBlob,
  );
});

test("redirects a thumbnail sample without a suffix to the same blob", () => {
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/feed_thumbnail/plain/${sampleDid}/${sampleCid}`),
    sampleBlob,
  );
});

test("redirects a webp and a png sample to the same blob", () => {
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/feed_fullsize/plain/${sampleDid}/${sampleCid}@webp`),
    sampleBlob,
  );
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/feed_fullsize/plain/${sampleDid}/${sampleCid}@png`),
    sampleBlob,
  );
});

test("redirects a sample whose suffix is upper case, as browsers match case insensitively", () => {
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/feed_fullsize/plain/${sampleDid}/${sampleCid}@JPEG`),
    sampleBlob,
  );
});

test("redirects a sample with a percent encoded DID and keeps the encoding", () => {
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/feed_fullsize/plain/${videoDid}/${sampleCid}@jpeg`),
    `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${videoDid}&cid=${sampleCid}`,
  );
});

test("leaves avatars and banners alone", () => {
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/avatar/plain/${sampleDid}/${sampleCid}@jpeg`),
    null,
  );
  assert.equal(
    redirectFor(`https://cdn.bsky.app/img/banner/plain/${sampleDid}/${sampleCid}@jpeg`),
    null,
  );
});

test("redirects a video playlist to the blob with the DID still percent encoded", () => {
  assert.equal(
    redirectFor(`https://video.bsky.app/watch/${videoDid}/${videoCid}/playlist.m3u8`),
    videoBlob,
  );
});

test("redirects a rendition playlist with a session query to the same blob", () => {
  assert.equal(
    redirectFor(
      `https://video.bsky.app/watch/${videoDid}/${videoCid}/720p/video.m3u8?session_id=abc`,
    ),
    videoBlob,
  );
});

test("leaves the video thumbnail alone", () => {
  assert.equal(
    redirectFor(`https://video.bsky.app/watch/${videoDid}/${videoCid}/thumbnail.jpg`),
    null,
  );
});

const inlineHeaders = [
  { header: "content-disposition", operation: "set", value: "inline" },
  {
    header: "content-security-policy",
    operation: "set",
    value:
      "default-src 'none'; img-src https://*.bsky.network https://bsky.social; media-src https://*.bsky.network https://bsky.social; sandbox",
  },
];

test("shows getBlob inline from a PDS host and from bsky.social with a policy that allows media and keeps the sandbox", () => {
  const pdsUrl = `https://pholiota.us-west.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=${sampleDid}&cid=${sampleCid}`;
  assert.deepEqual(responseHeadersFor(pdsUrl), inlineHeaders);
  assert.deepEqual(responseHeadersFor(sampleBlob), inlineHeaders);
});

test("leaves headers alone on other bsky.network and cdn responses", () => {
  assert.deepEqual(
    responseHeadersFor(
      "https://pholiota.us-west.host.bsky.network/xrpc/com.atproto.sync.getRepo?did=x",
    ),
    [],
  );
  assert.deepEqual(
    responseHeadersFor(
      `https://cdn.bsky.app/img/feed_fullsize/plain/${sampleDid}/${sampleCid}@jpeg`,
    ),
    [],
  );
});

test("every rule applies to top level navigations only", () => {
  for (const rule of rules) {
    assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
  }
});
