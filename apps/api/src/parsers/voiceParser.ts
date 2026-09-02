import { createReadStream } from "node:fs";
import OpenAI from "openai";
import type { StoredFile } from "../storage/types.js";

export async function transcribeVoice(file: StoredFile): Promise<string> {
  const client = new OpenAI();
  const result = await client.audio.transcriptions.create({
    file: createReadStream(file.absolutePath),
    model: "whisper-1",
  });

  return result.text.trim();
}
