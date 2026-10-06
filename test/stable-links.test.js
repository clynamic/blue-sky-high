const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "stable-links.js"), "utf8");

function loadPage(initialUrl, directory) {
  const page = {
    fetches: [],
    replacedWith: [],
    listeners: {},
    location: { href: initialUrl },
  };
  const context = {
    URL,
    Map,
    location: page.location,
    history: {
      state: { route: "kept" },
      replaceState(state, title, url) {
        page.replacedWith.push({ state, url });
        page.location.href = url;
        page.listeners.currententrychange?.();
      },
    },
    navigation: {
      addEventListener(name, listener) {
        page.listeners[name] = listener;
      },
    },
    fetch(url) {
      page.fetches.push(url);
      const handle = new URL(url).searchParams.get("handle");
      const answer = directory[handle];
      if (answer === undefined) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "InvalidRequest" }),
        });
      }
      if (answer === "network down") {
        return Promise.reject(new TypeError("NetworkError"));
      }
      if (answer === "empty body") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ did: answer }) });
    },
    encodeURIComponent,
  };
  vm.runInNewContext(script, context);
  page.urlChanged = () => page.listeners.currententrychange();
  return page;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("replaces the handle in a post URL with the DID and keeps the history state", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example/post/3abc", {
    "artist.example": "did:plc:artist",
  });
  await settle();
  assert.deepEqual(page.replacedWith, [
    { state: { route: "kept" }, url: "https://bsky.app/profile/did:plc:artist/post/3abc" },
  ]);
});

test("looks a handle up once across the page load and later URL changes", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example", {
    "artist.example": "did:plc:artist",
  });
  await settle();
  page.location.href = "https://bsky.app/profile/artist.example/post/3abc";
  await page.urlChanged();
  page.location.href = "https://bsky.app/profile/artist.example/followers";
  await page.urlChanged();
  assert.equal(page.fetches.length, 1);
  assert.equal(page.location.href, "https://bsky.app/profile/did:plc:artist/followers");
});

test("its own rewrite triggers no second lookup and no second rewrite", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example/post/3abc", {
    "artist.example": "did:plc:artist",
  });
  await settle();
  await settle();
  assert.equal(page.fetches.length, 1);
  assert.equal(page.replacedWith.length, 1);
});

test("leaves a did:web profile URL alone", async () => {
  const page = loadPage("https://bsky.app/profile/did:web:artist.example", {
    "did:web:artist.example": "did:plc:wrong",
  });
  await settle();
  assert.deepEqual(page.fetches, []);
  assert.deepEqual(page.replacedWith, []);
});

test("leaves a URL alone when the lookup answers without a DID", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example", {
    "artist.example": "empty body",
  });
  await settle();
  assert.deepEqual(page.replacedWith, []);
});

test("rewrites a feed URL under a profile and keeps the rest of the path", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example/feed/art", {
    "artist.example": "did:plc:artist",
  });
  await settle();
  assert.equal(page.location.href, "https://bsky.app/profile/did:plc:artist/feed/art");
});

test("leaves a URL that already carries a DID alone and makes no lookup", async () => {
  const page = loadPage("https://bsky.app/profile/did:plc:artist/post/3abc", {
    "artist.example": "did:plc:artist",
  });
  await settle();
  assert.deepEqual(page.fetches, []);
  assert.deepEqual(page.replacedWith, []);
});

test("leaves a URL alone when the handle does not resolve, and retries on the next visit", async () => {
  const directory = {};
  const page = loadPage("https://bsky.app/profile/gone.example", directory);
  await settle();
  assert.deepEqual(page.replacedWith, []);
  directory["gone.example"] = "did:plc:back";
  await page.urlChanged();
  assert.equal(page.location.href, "https://bsky.app/profile/did:plc:back");
});

test("leaves a URL alone when the network fails", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example", {
    "artist.example": "network down",
  });
  await settle();
  assert.deepEqual(page.replacedWith, []);
  assert.equal(page.location.href, "https://bsky.app/profile/artist.example");
});

test("does not rewrite when the page moved on during the lookup", async () => {
  const page = loadPage("https://bsky.app/profile/artist.example", {
    "artist.example": "did:plc:artist",
    "other.example": "did:plc:other",
  });
  page.location.href = "https://bsky.app/profile/other.example";
  await settle();
  assert.deepEqual(page.replacedWith, []);
});

test("ignores pages outside a profile", async () => {
  const page = loadPage("https://bsky.app/hashtag/artist.example", {
    "artist.example": "did:plc:artist",
  });
  await settle();
  assert.deepEqual(page.fetches, []);
});
