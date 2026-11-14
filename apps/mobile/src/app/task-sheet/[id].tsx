import { TaskCrash, TaskScreen } from "../../components/TaskScreen";

// The task sheet (the web's TaskModal as a sheet), opened from Home, Calendar,
// Search and Time left.
export const ErrorBoundary = TaskCrash;

export default function TaskSheet() {
  return <TaskScreen page={false} />;
}
