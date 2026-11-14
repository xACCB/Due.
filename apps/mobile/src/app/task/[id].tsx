import { TaskCrash, TaskScreen } from "../../components/TaskScreen";

// The task page (the web's TaskModal `page` form), opened from the sidebar.
export const ErrorBoundary = TaskCrash;

export default function TaskPage() {
  return <TaskScreen page />;
}
