// ─── Public Façade ──────────────────────────────────────────────────────────
// Single entry point for the cache layer.

export * from './blobs';
export * from './posts';
export * from './meta';
export * from './clear';
export * as db from './db';
export { wipeLegacy } from './wipeLegacy';
