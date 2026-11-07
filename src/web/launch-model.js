// Where a launch should take an Archipelago window that is already open (pure). Installed as an app, the page asks
// Chrome to focus the open window rather than open another (`launch_handler` in manifest.webmanifest); the link that
// launched it arrives as a target URL, and only a link that names another chart moves the window.

/** The URL to go to, or null to stay: a link to the app's front (`/`, nothing named) only brings it forward. */
export function launchNavigation(currentHref, targetHref) {
  let current;
  let target;
  try {
    current = new URL(currentHref);
    target = new URL(targetHref, currentHref);
  } catch {
    return null;
  }
  if (target.origin !== current.origin) return null;
  if (target.pathname !== current.pathname) return target.href;
  for (const [name, value] of target.searchParams) if (current.searchParams.get(name) !== value) return target.href;
  return null;
}
