/**
 * The log file: one line per event, written beside the executable.
 *
 * The writer is the backend. The frontend cannot reach that folder - the ACL
 * grants this window `fs:allow-write-text-file` and nothing that could name the
 * installation directory, whose path only exists once the installer has run -
 * and a writer in JavaScript would be silent in exactly the case this file
 * exists for, which is a webview that never came up.
 *
 * So this module does nothing but hand lines over, and nothing with the
 * result: it never throws, never shows anything, and never refuses to lose one.
 * A log line is diagnostics; diagnostics must not be able to stop the program
 * they were meant to describe.
 *
 * The events are descriptions, not data. Nothing here builds a client name, a
 * month, or an amount into a line, and the callers are written the same way -
 * they name the event and the reason, nothing more.
 */

import { invoke } from "@tauri-apps/api/core";

/** The level a line can be written at. The backend takes more and writes
 *  `info` for what it does not recognise; these are the ones this side sends. */
export type LogLevel = "info" | "warn" | "error";

/**
 * Writes one line, and waits for the backend to close the file it opened.
 *
 * Resolves with nothing, whatever the file did. Never rejects, so callers that
 * use `void` never need a catch of their own - and a failure inside the helper is
 * swallowed here rather than left to each call site to remember to do so.
 */
export async function logEvent(level: LogLevel, message: string): Promise<void> {
  try {
    await invoke("log_event", { level, message });
  } catch {
    // Deliberately empty: the contract on the function says the line may be
    // lost and that is the whole truth.
  }
}
