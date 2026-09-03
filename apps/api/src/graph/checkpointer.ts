import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";

export async function createCheckpointer(pool: Pool | null) {
  if (!pool) return new MemorySaver();
  const saver = new PostgresSaver(pool);
  await saver.setup();
  return saver;
}
