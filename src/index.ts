import "dotenv/config";
import { loadConfig } from "./config.js";

const config = loadConfig();

console.log(`PRD Generator ready on port ${config.port}`);
