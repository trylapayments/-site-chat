export type WorkspaceActionState = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialWorkspaceActionState: WorkspaceActionState = {
  success: false,
};
