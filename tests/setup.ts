// Ensures config/index.ts's required env vars are present before any test
// file imports it — tests never touch a real database, but the schema
// still requires DATABASE_URL to be set to parse successfully.
process.env.DATABASE_URL ??= "file:./test.db";
