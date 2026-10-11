/**
 * The API always runs in UTC, whatever the server's local time zone (some hosts and developer machines set TZ, e.g.
 * Asia/Qatar). Dates are stored as UTC and converted to the market's time only for display and day boundaries;
 * a local process time zone would shift timestamps written from the app against the database's own clock.
 * Imported first by main.ts.
 */
process.env.TZ = 'UTC';
export {};
