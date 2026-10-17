/**
 * Body limit constants for the Fastify API server.
 * All values are expressed in bytes.
 */

// Default global limit for JSON endpoints (auth, setup, webhooks, analytics, members)
export const DEFAULT_BODY_LIMIT_BYTES = 1048576; // 1 MB

// Media multipart file upload limit (matches max video size)
export const MEDIA_UPLOAD_BODY_LIMIT_BYTES = 524288000; // 500 MB

// Theme archive ZIP package upload limit
export const THEME_UPLOAD_BODY_LIMIT_BYTES = 52428800; // 50 MB

// Site content import envelope limit (JSON import/export)
export const IMPORT_EXPORT_BODY_LIMIT_BYTES = 52428800; // 50 MB

// Large document / template content limit (newsletters, posts, pages, translations)
export const DOCUMENT_CONTENT_BODY_LIMIT_BYTES = 10485760; // 10 MB
