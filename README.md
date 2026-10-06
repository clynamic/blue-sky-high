# Blue Sky High

<p align="center">
  <img src="public/icons/icon512.png" alt="Blue Sky High icon" width="128" height="128" />
</p>

A straight-forward tiny browser extension that ensures all the bluesky links you open are permanent links, and all the bluesky media you open is of the highest available quality served by bluesky. Best used in combination with the (other) funny blue site.

## Installation

There is currently no Extension Store version of this extension, neither Chrome nor Firefox, because thats complex and I am not sure if Google likes us very much. To use the extension, you have to manually install it.

### Chrome

Chrome version 102 or newer is required.

1. Download the `zip` file from [releases](https://github.com/clynamic/blue-sky-high/releases/latest).
2. Unpack this `zip` file into a permanent location of your choosing.
3. Open `chrome://extensions` in your browser.
4. Enable the "Developer mode" toggle in the top right.
5. Click "Load unpacked".
6. Select the unpacked extension folder.

Done!

### Firefox (Desktop)

Firefox version 147 or newer is required.

1. Download the `xpi` file from [releases](https://github.com/clynamic/blue-sky-high/releases/latest).
2. Open `about:addons` in your browser.
3. Click the cog icon, select "Install Add-on From File...".
4. Select the file you downloaded.
5. Confirm adding the add-on in the dialog.

Done!

### Firefox (Android)

Firefox version 147 or newer is required.

1. Download the `xpi` file from [releases](https://github.com/clynamic/blue-sky-high/releases/latest).
2. Open the Settings, About Firefox, tap the logo five times.
3. In Settings, tap "Install extension from file".
4. Select the file you downloaded.
5. Confirm adding the add-on in the dialog.

Done!

## Development

> [!WARNING]
> This section is for stupid nerds 🤓!! If you are not one of those, turn around now!

You will need to install [node.js v24](https://nodejs.org) and [npm](https://docs.npmjs.com/cli/v11/configuring-npm/install) to build the extension.

Quick file overview:

- `rules.json` contains the browser redirects for full quality media. Read more about these rules on the [mdn web docs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest).
- `stable-links.js` turns links into permanent links. Read more about DIDs in the [bluesky docs](https://bsky.network/docs/resolving-identities/).
- `media-source.js` fixes the `<img />` element in firefox not updating when we redirect. There is a very very old [bugzilla issue](https://bugzilla.mozilla.org/show_bug.cgi?id=311742) for this.

Those are the most important files. Every other file is mostly to make sure things work.

Commands:

```sh
npm install # fetch packages
npm test # ensure redirect and DID parsing works
npm run lint # ensure your JS is not terrible
npm run build # package extension
```
