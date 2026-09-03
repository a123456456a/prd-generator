/** A single message in the natural-language revision chat attached to a task. */
export type ConversationRole = "user" | "assistant";

/** Which generated artifact a chat message is about. */
export type ReviseTarget = "prd" | "prototype";

export type ConversationTurn = {
  role: ConversationRole;
  target: ReviseTarget;
  message: string;
  createdAt: string;
};
