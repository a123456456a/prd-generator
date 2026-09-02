import { MemorySaver } from "@langchain/langgraph";

export function createCheckpointer(): MemorySaver {
  return new MemorySaver();
}
