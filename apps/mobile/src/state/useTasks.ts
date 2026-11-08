import { useEffect, useReducer } from "react";
import type { Task } from "@dueplanner/core/types";
import type { TrashEntry } from "@dueplanner/core/lib/trash";
import { pruneTrash } from "@dueplanner/core/lib/trash";
import { migrateTasks, SCHEMA_VERSION } from "@dueplanner/core/lib/migrations";
import { readJSON, writeJSON } from "../lib/storage";
import * as S from "./taskStore";

type Op =
  | { kind: "add"; title: string }
  | { kind: "toggle"; id: number }
  | { kind: "delete"; id: number }
  | { kind: "undo" }
  | { kind: "redo" };

function reduce(s: S.TaskStore, op: Op): S.TaskStore {
  switch (op.kind) {
    case "add": return S.addTask(s, op.title);
    case "toggle": return S.toggleDone(s, op.id);
    case "delete": return S.deleteTask(s, op.id);
    case "undo": return S.undo(s);
    case "redo": return S.redo(s);
  }
}

// Saved tasks are brought up to this app's data version on the way in, the
// same migrations the web app runs (core's lib/migrations.ts).
function load(): S.TaskStore {
  const raw = readJSON<unknown>("hw-tasks", []);
  const tasks = Array.isArray(raw) ? migrateTasks(raw as Record<string, unknown>[], readJSON("hw-schema", 0)) : [];
  const trash = pruneTrash(readJSON<TrashEntry[]>("hw-trash", []));
  return S.emptyStore(tasks as Task[], trash);
}

export function useTasks() {
  const [store, dispatch] = useReducer(reduce, undefined, load);

  useEffect(() => {
    writeJSON("hw-tasks", store.tasks);
    writeJSON("hw-schema", SCHEMA_VERSION);
  }, [store.tasks]);
  useEffect(() => { writeJSON("hw-trash", store.trash); }, [store.trash]);

  return {
    tasks: store.tasks,
    canUndo: store.undo.length > 0,
    canRedo: store.redo.length > 0,
    add: (title: string) => dispatch({ kind: "add", title }),
    toggle: (id: number) => dispatch({ kind: "toggle", id }),
    remove: (id: number) => dispatch({ kind: "delete", id }),
    undo: () => dispatch({ kind: "undo" }),
    redo: () => dispatch({ kind: "redo" }),
  };
}
