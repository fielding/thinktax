/**
 * Simple logger with verbose mode support
 */

let verboseEnabled = false

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled
}

export function isVerbose(): boolean {
  return verboseEnabled
}

export function debug(...args: unknown[]): void {
  if (verboseEnabled) {
    console.error("[debug]", ...args)
  }
}

export function info(...args: unknown[]): void {
  console.log(...args)
}

export function warn(...args: unknown[]): void {
  console.error("[warn]", ...args)
}

export function error(...args: unknown[]): void {
  console.error("[error]", ...args)
}
