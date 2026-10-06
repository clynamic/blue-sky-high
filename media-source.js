const shown = document.images[0] ?? document.querySelector("video");

if (shown && shown.currentSrc !== location.href) {
  shown.removeAttribute("src");
  shown.src = location.href;
}
