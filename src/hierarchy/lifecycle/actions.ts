export type HierarchyMaintenanceAction = {
  kind: string;
  scope?: "slice" | "parent" | "project" | "history";
  message: string;
  _apply?: () => void | Promise<void>;
};
