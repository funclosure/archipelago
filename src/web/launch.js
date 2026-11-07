// The page's half of the installed app's launch (launch-model.js says where to go): Chrome hands an open window the
// link that launched it through `launchQueue`; a link naming another chart opens it there, any other only focuses.
import { launchNavigation } from "./launch-model.js";

export function installLaunch() {
  if (!("launchQueue" in window)) return; // not installed, or not Chrome: links open as they always have
  window.launchQueue.setConsumer((params) => {
    if (!params?.targetURL) return;
    const next = launchNavigation(location.href, params.targetURL);
    if (next) location.assign(next);
  });
}
