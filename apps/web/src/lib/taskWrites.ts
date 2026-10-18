// The task write builder (@dueplanner/core/lib/taskWrites) bound to the
// Firebase JS SDK. The app's sync effect and the rules tests in tests/ both
// use these, so the rules are tested against exactly the writes the app sends.
import { deleteField, increment } from "firebase/firestore";
import type { DocumentReference } from "firebase/firestore";
import { makeTaskWrites } from "@dueplanner/core/lib/taskWrites";
export type { TaskRefs } from "@dueplanner/core/lib/taskWrites";

export const { addTaskWrite, addTaskWriteFromActual } = makeTaskWrites<DocumentReference>({ deleteField, increment });
