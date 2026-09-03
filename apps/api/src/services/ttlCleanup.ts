import type { SessionStore } from "../auth/types.js";
import type { Storage } from "../storage/types.js";
import type { ArtifactWriter } from "./artifactWriter.js";
import type { TaskSnapshot } from "./taskService.js";
import type { TaskStore } from "./taskStore.js";

export interface SessionStoreWithExpiry extends SessionStore {
  deleteExpired(now: Date): Promise<void>;
}

export interface CheckpointerWithDelete {
  deleteThread?(threadId: string): Promise<void>;
}

type TaskSnapshotWithFiles = TaskSnapshot & {
  rawFiles?: { storageKey: string }[];
};

export interface TtlCleanupArgs {
  taskStore: TaskStore;
  sessionStore?: SessionStore;
  storage: Storage;
  /** Removes an expired task's persisted deliverables from `outputs/`. Optional for backward compatibility. */
  artifactWriter?: ArtifactWriter;
  checkpointer: CheckpointerWithDelete;
  now?: Date;
}

function hasDeleteExpired(
  store: SessionStore,
): store is SessionStoreWithExpiry {
  return (
    "deleteExpired" in store &&
    typeof store.deleteExpired === "function"
  );
}

export async function runTtlCleanup({
  taskStore,
  sessionStore,
  storage,
  artifactWriter,
  checkpointer,
  now = new Date(),
}: TtlCleanupArgs): Promise<{ tasksRemoved: number }> {
  const expired = await taskStore.listExpired(now);
  let tasksRemoved = 0;

  for (const task of expired) {
    const snapshot = task as TaskSnapshotWithFiles;
    if (snapshot.rawFiles?.length) {
      await Promise.allSettled(
        snapshot.rawFiles.map((file) => storage.remove(file.storageKey)),
      );
    }
    await artifactWriter?.remove(task.threadId);
    await checkpointer.deleteThread?.(task.threadId);
    await taskStore.delete(task.threadId);
    tasksRemoved++;
  }

  if (sessionStore && hasDeleteExpired(sessionStore)) {
    await sessionStore.deleteExpired(now);
  }

  return { tasksRemoved };
}
