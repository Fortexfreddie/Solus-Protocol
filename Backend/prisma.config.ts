import "dotenv/config";
import { defineConfig } from "prisma/config";

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Switch between local DB and Supabase Direct URL
    url: isProduction 
      ? process.env["DIRECT_URL"] 
      : process.env["DATABASE_URL"], 
  },
});