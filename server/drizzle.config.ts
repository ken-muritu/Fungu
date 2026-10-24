import { defineConfig } from "drizzle-kit";

// No `driver` field — drizzle-kit 0.28's Config type only allows "d1-http"
// or "expo" there; a plain `dialect: "sqlite"` + a libsql:// URL is enough
// for it to use the libSQL/Turso driver internally.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
