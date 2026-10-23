/**
 * Every application-level value that is not a business rule.
 *
 * These used to be literals at their point of use - a duration here, a bound
 * there - which is harmless until someone needs to change one and has to
 * search for it. They live here so a change is one line in one place.
 *
 * What is deliberately NOT here, and why:
 *
 *  - **Anything from `src-tauri/tauri.conf.json`.** The bundle identifier, the
 *    window size, the updater endpoint and its public key, the product name
 *    and version. Those are read by the Rust build and compiled into the
 *    .exe, so no file this module could read would change them at runtime -
 *    that is a property of how Tauri is built, not a choice. They are already
 *    gathered in one config file, which is where they have to stay. Changing
 *    the endpoint means editing `tauri.conf.json` and shipping a new build.
 *
 *  - **Rules about the data itself**, such as a month having 1 to 12 months or
 *    an upcoming deadline being 30 days out. Those sit in
 *    `domain/recurrence.ts` beside the logic they belong to. A constant with
 *    no setting behind it is not a property; it is a number that has been
 *    moved further from its meaning.
 */

/**
 * The database file, which the SQL plugin resolves against the app's data
 * directory.
 *
 * The name appears in three languages and they cannot share a constant: here
 * in TypeScript, in `lib/dbPath.cjs` (the tests need it in plain Node, where
 * TypeScript is not available) and in `src-tauri/src/migration.rs` (which
 * moves the file when the bundle identifier changes). `audit-config.cjs`
 * reads all three and fails if they ever disagree.
 */
export const DB_FILE_NAME = "accountant.db";

/** How long a client's card keeps pulsing after a reminder selects it. */
export const HIGHLIGHT_PULSE_MS = 2600;

/**
 * Delay before the startup update check runs.
 *
 * It is deferred rather than run on mount so the check never competes with the
 * database in the first seconds of the application, which is when it would be
 * least welcome anyway. Half a minute is long enough for the window to be
 * usable and the queries to have settled, and short enough that a machine
 * which has been on since the morning hears about a new version without
 * anyone having to ask for it.
 */
export const UPDATE_CHECK_DELAY_MS = 30000;

/** How long a toast stays on screen before it dismisses itself. */
export const TOAST_TIMEOUT_MS = 3500;

/** A due day is a day of the month. */
export const DUE_DAY_MIN = 1;
export const DUE_DAY_MAX = 31;

/**
 * How far ahead a reminder can be set, in days. Zero is meaningful and means
 * "warn me on the day itself", which is why the minimum is not 1.
 */
export const REMINDER_DAYS_MIN = 0;
export const REMINDER_DAYS_MAX = 90;
