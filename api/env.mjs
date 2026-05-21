import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [
  resolve(__dirname, "../.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, ".env"),
]) {
  dotenv.config({ path: p });
}
