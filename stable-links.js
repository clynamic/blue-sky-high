const didShape = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const lookupByHandle = new Map();

function handleInProfileUrl(url) {
  const segments = new URL(url).pathname.split("/");
  const section = segments[1];
  const actor = segments[2];
  if (section !== "profile" || !actor || actor.startsWith("did:")) {
    return null;
  }
  return actor;
}

async function fetchDid(handle) {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    );
    const body = response.ok ? await response.json() : {};
    return didShape.test(body.did) ? body.did : null;
  } catch {
    return null;
  }
}

function lookUpDid(handle) {
  if (!lookupByHandle.has(handle)) {
    const lookup = fetchDid(handle).then((did) => {
      if (!did) {
        lookupByHandle.delete(handle);
      }
      return did;
    });
    lookupByHandle.set(handle, lookup);
  }
  return lookupByHandle.get(handle);
}

async function replaceHandleWithDid() {
  const urlBeforeLookup = location.href;
  const handle = handleInProfileUrl(urlBeforeLookup);
  if (!handle) {
    return;
  }
  const did = await lookUpDid(handle);
  const pageMovedOn = location.href !== urlBeforeLookup;
  if (!did || pageMovedOn) {
    return;
  }
  history.replaceState(
    history.state,
    "",
    urlBeforeLookup.replace(`/profile/${handle}`, `/profile/${did}`),
  );
}

replaceHandleWithDid();
navigation.addEventListener("currententrychange", replaceHandleWithDid);
