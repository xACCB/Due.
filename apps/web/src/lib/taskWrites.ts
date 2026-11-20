// The task write builder (@dueplanner/core/lib/taskWrites) bound to the
// Firebase JS SDK, for the rules tests in tests/ and the legacy task-list
// move in App.tsx. The sync engine builds its writes with the same
// makeTaskWrites over the same SDK (lib/cloudSync.ts), so the rules are
// tested against exactly the writes the app sends.
import { deleteField, increment } from "firebase/firestore";
import type { DocumentReference } from "firebase/firestore";
import { makeTaskWrites } from "@dueplanner/core/lib/taskWrites";
export type { TaskRefs } from "@dueplanner/core/lib/taskWrites";

export const { addTaskWrite, addTaskWriteFromActual } = makeTaskWrites<DocumentReference>({ deleteField, increment });
