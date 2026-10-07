const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { Builder, Browser, By, until } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const chrome = require("selenium-webdriver/chrome");
const geckodriver = require("geckodriver");

const fixtures = {
  image: {
    did: "did:plc:o55tuozxhqspgx6lz4rhxopc",
    cid: "bafkreiezt3vadij5ksnwj7edfderpss6jolauavs54x73euzm5yor6b46e",
    postKey: "3mvdycv6wos22",
    width: 1127,
  },
  video: {
    did: "did:plc:na5y3i342ylztepuaf5jp2cq",
    cid: "bafkreichhstfi7ginpnok6kqmmhspi5luun5dawdkyxkv5uytiil2nsddy",
    postKey: "3mwtg76ofjk2h",
    width: 2400,
  },
};

const root = path.resolve(__dirname, "..");
const target = valueOfFlag("--target") ?? "firefox";
const headed = process.argv.includes("--headed");
const only = valueOfFlag("--only")?.split(",");
const runDir = path.join(root, "scratch", "verify", target);
const downloadDir = path.join(runDir, "downloads");

const results = [];

function valueOfFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function record(item, outcome, detail) {
  results.push({ item, outcome, detail });
  console.log(`${outcome.padEnd(4)}  ${item}  ${detail}`);
}

async function check(item, run) {
  if (only && !only.includes(item.split(" ")[0])) {
    return;
  }
  try {
    const detail = await run();
    record(item, "pass", detail ?? "");
  } catch (error) {
    record(item, "FAIL", error.message.split("\n")[0]);
  }
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.json();
}

async function resolveCase(fixture) {
  const didDocument = await fetchJson(`https://plc.directory/${fixture.did}`);
  const pds = didDocument.service.find((service) => service.id === "#atproto_pds").serviceEndpoint;
  const profile = await fetchJson(
    `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${fixture.did}`,
  );
  const blobFor = (did) => `${pds}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${fixture.cid}`;
  return {
    ...fixture,
    pds,
    handle: profile.handle,
    avatar: profile.avatar,
    blob: blobFor(fixture.did),
    encodedBlob: blobFor(encodeURIComponent(fixture.did)),
    sample: (variant, suffix) =>
      `https://cdn.bsky.app/img/${variant}/plain/${fixture.did}/${fixture.cid}${suffix}`,
    watch: (file) =>
      `https://video.bsky.app/watch/${encodeURIComponent(fixture.did)}/${fixture.cid}/${file}`,
    postWithHandle: `https://bsky.app/profile/${profile.handle}/post/${fixture.postKey}`,
    postWithDid: `https://bsky.app/profile/${fixture.did}/post/${fixture.postKey}`,
    profileWithHandle: `https://bsky.app/profile/${profile.handle}`,
    profileWithDid: `https://bsky.app/profile/${fixture.did}`,
  };
}

function builtArtifact() {
  const dir = path.join(root, "web-ext-artifacts");
  execFileSync("npx", ["web-ext", "build", "--overwrite-dest"], { cwd: root, stdio: "ignore" });
  const [newest] = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".zip"))
    .map((name) => path.join(dir, name))
    .toSorted((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return newest;
}

function unpackedCopy(artifact) {
  const dir = path.join(runDir, "extension");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-oq", artifact, "-d", dir]);
  return dir;
}

function firstOnPath(...names) {
  for (const name of names) {
    try {
      return execFileSync("which", [name]).toString().trim();
    } catch {
      continue;
    }
  }
  throw new Error(`none of ${names.join(", ")} is on PATH`);
}

async function buildDriver() {
  fs.rmSync(downloadDir, { recursive: true, force: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  const artifact = builtArtifact();
  if (target === "chromium") {
    const options = new chrome.Options()
      .setChromeBinaryPath(
        process.env.CHROME_BINARY ??
          firstOnPath("chromium", "google-chrome-stable", "google-chrome"),
      )
      .addArguments(
        `--load-extension=${unpackedCopy(artifact)}`,
        "--no-first-run",
        "--window-size=1280,900",
      )
      .setUserPreferences({
        "download.default_directory": downloadDir,
        "download.prompt_for_download": false,
      });
    if (!headed) {
      options.addArguments("--headless=new");
    }
    return new Builder()
      .forBrowser(Browser.CHROME)
      .setChromeOptions(options)
      .setChromeService(
        new chrome.ServiceBuilder(process.env.CHROMEDRIVER ?? firstOnPath("chromedriver")),
      )
      .build();
  }
  const options = new firefox.Options();
  if (target === "android") {
    options.enableMobile("org.mozilla.firefox");
  } else {
    options
      .windowSize({ width: 1280, height: 900 })
      .setPreference("browser.download.folderList", 2)
      .setPreference("browser.download.dir", downloadDir)
      .setPreference("browser.download.useDownloadDir", true)
      .setPreference("browser.download.always_ask_before_handling_new_types", false)
      .setPreference(
        "browser.helperApps.neverAsk.saveToDisk",
        "application/octet-stream,image/jpeg,video/mp4",
      );
    if (!headed) {
      options.addArguments("-headless");
    }
  }
  const driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(await geckodriver.download()))
    .build();
  await driver.installAddon(artifact, true);
  return driver;
}

async function urlWhere(driver, predicate, timeout = 20000) {
  try {
    await driver.wait(async () => predicate(await driver.getCurrentUrl()), timeout);
  } catch (error) {
    throw new Error(`${error.message.split("\n")[0]}, url is ${await driver.getCurrentUrl()}`, {
      cause: error,
    });
  }
  return driver.getCurrentUrl();
}

async function urlAfterSettling(driver, millis = 3000) {
  await driver.sleep(millis);
  return driver.getCurrentUrl();
}

function shownMedia(driver) {
  return driver.executeScript(`
    const picture = document.images[0];
    const clip = document.querySelector("video");
    return {
      contentType: document.contentType,
      width: picture ? picture.naturalWidth : clip ? clip.videoWidth : 0,
      readyState: clip ? clip.readyState : undefined,
      networkState: clip ? clip.networkState : undefined,
      error: clip && clip.error ? clip.error.code : undefined,
    };
  `);
}

async function shownWidth(driver, expected) {
  try {
    await driver.wait(async () => (await shownMedia(driver)).width > 0, 40000);
  } catch (error) {
    throw new Error(
      `${error.message.split("\n")[0]}, media is ${JSON.stringify(await shownMedia(driver))}`,
      { cause: error },
    );
  }
  const media = await shownMedia(driver);
  if (expected !== undefined) {
    expectEqual(media.width, expected, "width");
  }
  return media;
}

async function expectStaysPainted(driver, expectedWidth, graceMillis) {
  const started = Date.now();
  const widths = [];
  while (Date.now() - started < 2000) {
    const width = await driver.executeScript(`
      const shown = document.images[0] ?? document.querySelector("video");
      return shown ? (shown.naturalWidth ?? shown.videoWidth) : 0;
    `);
    widths.push([Date.now() - started, width]);
  }
  const firstPainted = widths.find(([, width]) => width === expectedWidth);
  if (!firstPainted) {
    throw new Error(`never painted at ${expectedWidth}px within 2 s of load`);
  }
  if (firstPainted[0] > graceMillis) {
    throw new Error(`first painted ${firstPainted[0]} ms after load, allowed ${graceMillis}`);
  }
  const dropped = widths.find(([at, width]) => at > firstPainted[0] && width !== expectedWidth);
  if (dropped) {
    throw new Error(`painted frame dropped to ${dropped[1]}px at ${dropped[0]} ms after load`);
  }
  return `${firstPainted[0]} ms after load, ${widths.length} samples`;
}

async function hashFetchedByBrowser(driver, url) {
  await driver.get("about:blank");
  const base64 = await driver.executeAsyncScript(
    `
    const done = arguments[arguments.length - 1];
    fetch(arguments[0])
      .then((response) => response.blob())
      .then((blob) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.readAsDataURL(blob);
      }))
      .then(done)
      .catch((error) => done("error: " + error.message));
  `,
    url,
  );
  if (base64.startsWith("error:")) {
    throw new Error(base64);
  }
  return crypto.createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

async function fetchedHash(url) {
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  return { hash: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function documentLoadedAt(driver) {
  return driver.executeScript(`
    const entries = performance.getEntriesByType("navigation");
    return { loadedUrl: entries[0].name, entries: entries.length };
  `);
}

function downloadedFiles() {
  return fs
    .readdirSync(downloadDir)
    .filter(
      (name) => !name.startsWith(".") && !name.endsWith(".part") && !name.endsWith(".crdownload"),
    );
}

function expectNoDownload() {
  const files = downloadedFiles();
  if (files.length) {
    throw new Error(`a download started: ${files.join(", ")}`);
  }
}

async function waitForDownload(timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const files = downloadedFiles();
    if (files.length) {
      return files;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("no download arrived");
}

async function screenshot(driver, name) {
  if (target === "android") {
    return;
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, `${name}.png`), await driver.takeScreenshot(), "base64");
}

async function clickVisible(driver, selector) {
  let href;
  await driver.wait(async () => {
    href = await driver.executeScript(
      `
      const link = [...document.querySelectorAll(arguments[0])].find((candidate) => candidate.getClientRects().length > 0);
      if (link) {
        link.click();
      }
      return link ? link.getAttribute("href") : null;
    `,
      selector,
    );
    return Boolean(href);
  }, 30000);
  return href;
}

async function startLoadingInNewTab(driver, url) {
  await driver.switchTo().newWindow("tab");
  if (target === "android") {
    await driver.get(url);
  } else {
    await driver.executeScript("location.href = arguments[0]", url);
  }
  return driver.getWindowHandle();
}

async function closeOtherTabs(driver) {
  const [keep, ...others] = await driver.getAllWindowHandles();
  if (target === "android") {
    await driver.switchTo().window(keep);
    return;
  }
  for (const handle of others) {
    await driver.switchTo().window(handle);
    await driver.close();
  }
  await driver.switchTo().window(keep);
}

async function imageChecks(driver, image) {
  await check("1 sample opens as the blob at the PDS URL", async () => {
    await driver.get(image.sample("feed_fullsize", "@jpeg"));
    expectEqual(await urlWhere(driver, (u) => u.startsWith(image.pds)), image.blob, "url");
    const media = await shownWidth(driver, image.width);
    const paintedAfter = await expectStaysPainted(driver, image.width, 100);
    expectNoDownload();
    await screenshot(driver, "item-01");
    return `${media.contentType} ${media.width}px wide, painted ${paintedAfter}, kept`;
  });

  await check("2 thumbnail, webp, png and bare samples open as the same blob", async () => {
    for (const [variant, suffix] of [
      ["feed_thumbnail", "@jpeg"],
      ["feed_fullsize", "@webp"],
      ["feed_fullsize", "@png"],
      ["feed_fullsize", ""],
    ]) {
      await driver.get(image.sample(variant, suffix));
      expectEqual(
        await urlWhere(driver, (u) => u.startsWith(image.pds)),
        image.blob,
        `${variant}${suffix}`,
      );
    }
  });

  await check("4 the URL shown serves the same bytes the harness downloaded", async () => {
    await driver.get(image.sample("feed_fullsize", "@jpeg"));
    const shown = await urlWhere(driver, (u) => u.startsWith(image.pds));
    const expected = await fetchedHash(shown);
    expectEqual(await hashFetchedByBrowser(driver, shown), expected.hash, "sha256");
    return `${expected.size} bytes`;
  });

  await check("5 ten samples open in separate tabs each show their blob", async () => {
    await driver.get("about:blank");
    const handles = [];
    for (let i = 0; i < 10; i++) {
      handles.push(await startLoadingInNewTab(driver, image.sample("feed_fullsize", "@jpeg")));
    }
    for (const handle of handles) {
      await driver.switchTo().window(handle);
      expectEqual(await urlWhere(driver, (u) => u.startsWith(image.pds)), image.blob, "url");
      await shownWidth(driver, image.width);
    }
    expectNoDownload();
    await closeOtherTabs(driver);
    return target === "android"
      ? "tabs load one at a time on Android, as the browser shows them"
      : "ten tabs loading at once";
  });

  await check("6 images inside bsky.app still load as CDN samples", async () => {
    await driver.get(image.postWithDid);
    const picture = await driver.wait(
      until.elementLocated(
        By.css(`img[src*="cdn.bsky.app/img/feed_thumbnail/plain/${image.did}/${image.cid}"]`),
      ),
      30000,
    );
    await driver.executeScript(
      'arguments[0].loading = "eager"; arguments[0].scrollIntoView()',
      picture,
    );
    try {
      await driver.wait(async () => (await picture.getAttribute("naturalWidth")) > 0, 20000);
    } catch (error) {
      const state = await driver.executeScript(
        "return { complete: arguments[0].complete, src: arguments[0].currentSrc, rect: arguments[0].getBoundingClientRect().toJSON() }",
        picture,
      );
      throw new Error(`the in-app image never loaded: ${JSON.stringify(state)}`, { cause: error });
    }
    const width = Number(await picture.getAttribute("naturalWidth"));
    if (width >= image.width) {
      throw new Error(
        `the in-app image is ${width}px wide, the blob's width, so it was redirected`,
      );
    }
    return `thumbnail shown at ${width}px, blob is ${image.width}px`;
  });

  await check("7 avatars and banners are untouched", async () => {
    await driver.get(image.avatar);
    expectEqual(await urlAfterSettling(driver), image.avatar, "url");
    const media = await shownWidth(driver);
    if (!media.contentType.startsWith("image/")) {
      throw new Error(`avatar shown as ${media.contentType}`);
    }
    return `${media.contentType} ${media.width}px wide`;
  });

  await check("8 copy image address yields the getBlob URL", async () => {
    await driver.get(image.sample("feed_fullsize", "@jpeg"));
    const shown = await urlWhere(driver, (u) => u.startsWith(image.pds));
    const imageSource = () => driver.executeScript("return document.images[0].currentSrc");
    expectEqual(await imageSource(), shown, "image source at load");
  });
}

async function videoChecks(driver, video) {
  await check("10 playlist opens as the original video at the PDS URL", async () => {
    await driver.get(video.watch("playlist.m3u8"));
    expectEqual(await urlWhere(driver, (u) => u.startsWith(video.pds)), video.encodedBlob, "url");
    const media = await shownWidth(driver, video.width);
    const paintedAfter = await expectStaysPainted(driver, video.width, 500);
    expectNoDownload();
    expectEqual(
      await driver.executeScript('return document.querySelector("video").currentSrc'),
      await driver.getCurrentUrl(),
      "video source",
    );
    await screenshot(driver, "item-10");
    return `${media.contentType} ${media.width}px wide, painted ${paintedAfter}, kept`;
  });

  await check("11 rendition playlists open as the same video", async () => {
    for (const file of ["720p/video.m3u8", "360p/video.m3u8"]) {
      await driver.get(video.watch(file));
      expectEqual(await urlWhere(driver, (u) => u.startsWith(video.pds)), video.encodedBlob, file);
    }
  });

  await check("12 the video thumbnail is untouched", async () => {
    await driver.get("about:blank");
    await driver.manage().setTimeouts({ pageLoad: 8000 });
    try {
      await driver.get(video.watch("thumbnail.jpg"));
    } catch (error) {
      if (error.name !== "TimeoutError") {
        throw error;
      }
    } finally {
      await driver.manage().setTimeouts({ pageLoad: 60000 });
    }
    const url = await driver.getCurrentUrl();
    if (url.includes("getBlob")) {
      throw new Error(`thumbnail was redirected: ${url}`);
    }
    if (url !== "about:blank") {
      return url;
    }
    if (target === "android") {
      return "the thumbnail is served as a download by Bluesky";
    }
    const files = await waitForDownload();
    expectEqual(files.join(","), "thumbnail.jpg", "downloaded file");
    fs.rmSync(path.join(downloadDir, "thumbnail.jpg"));
    return "Bluesky serves the thumbnail as a download, and it arrived under its own name";
  });

  await check("13 the video URL shown serves the same bytes the harness downloaded", async () => {
    await driver.get(video.watch("playlist.m3u8"));
    const shown = await urlWhere(driver, (u) => u.startsWith(video.pds));
    const expected = await fetchedHash(shown);
    expectEqual(await hashFetchedByBrowser(driver, shown), expected.hash, "sha256");
    return `${expected.size} bytes`;
  });

  await check("14 video inside bsky.app still streams from the video CDN", async () => {
    await driver.get(video.postWithDid);
    await driver.wait(until.elementLocated(By.css('[data-testid="postThreadScreen"]')), 30000);
    const playlist = video.watch("playlist.m3u8");
    const answer = await driver.executeAsyncScript(
      `
      const done = arguments[arguments.length - 1];
      fetch(arguments[0])
        .then((response) => response.text().then((body) => done({ url: response.url, firstLine: body.split("\\n")[0] })))
        .catch((error) => done({ error: error.message }));
    `,
      playlist,
    );
    if (answer.error) {
      throw new Error(`the playlist request failed: ${answer.error}`);
    }
    expectEqual(answer.url, playlist, "playlist response url");
    expectEqual(answer.firstLine, "#EXTM3U", "playlist first line");
    return "the player's playlist request from bsky.app reaches the video CDN untouched";
  });
}

async function linkChecks(driver, image) {
  await check("15 a post URL with a handle gets the DID without reloading", async () => {
    await driver.get(image.postWithHandle);
    expectEqual(await urlWhere(driver, (u) => u.includes(image.did)), image.postWithDid, "url");
    const loaded = await documentLoadedAt(driver);
    expectEqual(loaded.loadedUrl, image.postWithHandle, "url the document was loaded at");
    expectEqual(loaded.entries, 1, "navigation entries");
    await screenshot(driver, "item-15");
  });

  await check(
    "16 entering at the home feed and moving in-app to a profile and a post gets the DID",
    async () => {
      await driver.get("https://bsky.app/");
      const authorHref = await clickVisible(
        driver,
        'a[href^="/profile/"]:not([href^="/profile/did:"]):not([href*="/post/"]):not([href*="/feed/"])',
      );
      const handle = authorHref.split("/")[2];
      const { did } = await fetchJson(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`,
      );
      expectEqual(
        await urlWhere(driver, (u) => u.includes(did)),
        `https://bsky.app/profile/${did}`,
        "profile url",
      );
      await clickVisible(driver, `a[href^="/profile/${handle}/post/"]`);
      const postUrl = await urlWhere(driver, (u) => u.includes("/post/") && !u.includes(handle));
      if (!postUrl.startsWith(`https://bsky.app/profile/${did}/post/`)) {
        throw new Error(`post url is ${postUrl}`);
      }
      await driver.navigate().back();
      expectEqual(
        await urlWhere(driver, (u) => !u.includes("/post/")),
        `https://bsky.app/profile/${did}`,
        "url after back",
      );
      const loaded = await documentLoadedAt(driver);
      expectEqual(loaded.entries, 1, "navigation entries");
      return `via ${handle}`;
    },
  );

  await check("17 a URL that already carries a DID is left alone", async () => {
    await driver.get(image.postWithDid);
    expectEqual(await urlAfterSettling(driver), image.postWithDid, "url");
  });

  await check("18 a handle that does not resolve keeps its URL", async () => {
    const unknown = "https://bsky.app/profile/no-such-handle-for-blue-sky-high.invalid";
    await driver.get(unknown);
    expectEqual(await urlAfterSettling(driver, 5000), unknown, "url");
  });
}

async function main() {
  const image = await resolveCase(fixtures.image);
  const video = await resolveCase(fixtures.video);
  console.log(
    `image case ${image.handle} on ${image.pds}, video case ${video.handle} on ${video.pds}`,
  );
  const driver = await buildDriver();
  await driver.manage().setTimeouts({ pageLoad: 60000, script: 60000 });
  try {
    await imageChecks(driver, image);
    await videoChecks(driver, video);
    await linkChecks(driver, image);
  } finally {
    await driver.quit();
  }
  const failed = results.filter((result) => result.outcome === "FAIL");
  const skipped = results.filter((result) => result.outcome === "skip");
  const passed = results.length - failed.length - skipped.length;
  console.log(
    `\n${target}: ${passed} of ${results.length} checks passed${skipped.length ? `, ${skipped.length} skipped` : ""}`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
