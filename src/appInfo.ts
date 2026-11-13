import packageJson from "../package.json";

/** Build-time identity shared by the UI and the package manifest. */
export const APP_NAME = "Accountant Util";
export const APP_VERSION = packageJson.version;

export const UPDATE_STORAGE_KEY = "accountant-util.update-info";

export interface UpdateInfo {
  version: string;
  updatedAt: string;
}

export function readUpdateInfo(): UpdateInfo | null {
  try {
    const raw = window.localStorage.getItem(UPDATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UpdateInfo>;
    return typeof parsed.version === "string" && typeof parsed.updatedAt === "string"
      ? { version: parsed.version, updatedAt: parsed.updatedAt }
      : null;
  } catch {
    return null;
  }
}

/** Records the first launch after a version change, without treating first install as an update. */
export function recordVersionLaunch(): UpdateInfo | null {
  const previous = readUpdateInfo();
  if (previous?.version === APP_VERSION) return previous;

  const now = new Date().toISOString();
  const next = previous ? { version: APP_VERSION, updatedAt: now } : { version: APP_VERSION, updatedAt: "" };
  try {
    window.localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The application remains usable when local storage is unavailable.
  }
  return next.updatedAt ? next : null;
}
