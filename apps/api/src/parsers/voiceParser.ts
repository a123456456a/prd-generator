import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { loadConfig } from "../config.js";
import { buildOpenAIClientOptions } from "../llm/createChatModel.js";
import type { StoredFile } from "../storage/types.js";

export async function transcribeVoice(file: StoredFile): Promise<string> {
  const config = loadConfig();
  const client = new OpenAI(buildOpenAIClientOptions(config));
  const result = await client.audio.transcriptions.create({
    file: createReadStream(file.absolutePath),
    model: "whisper-1",
  });

  return result.text.trim();
}
