/**
 * English operator strings for conversation assignment UI.
 * Centralized so components never hardcode labels.
 * Operator dashboard locale packs are backlog; keys are ready for mapping.
 */
export const assignmentMessagesEn = {
  filterLabel: "Assignment",
  filterMine: "Mine",
  filterUnassigned: "Unassigned",
  filterAll: "All",
  sectionTitle: "Assignment",
  assignedTo: "Assigned to",
  unassigned: "Unassigned",
  take: "Take",
  assign: "Assign",
  transfer: "Transfer",
  unassign: "Unassign",
  assignmentChanged: "Assignment changed",
  currentAssignee: "Current assignee",
  selectAssignee: "Select an assignee",
  searchMembers: "Search members",
  noMembers: "No assignable members",
  memberUnavailable: "That member is no longer assignable",
  taking: "Taking…",
  assigning: "Assigning…",
  unassigning: "Unassigning…",
  conflict: "This conversation was just assigned to someone else.",
  conflictRefresh: "Showing the current assignee.",
  forbidden: "You do not have permission to change assignment.",
  notFound: "Conversation not found.",
  genericError: "Unable to update assignment. Please try again.",
  takeSuccess: "Conversation assigned to you",
  you: "You",
  transferSuccess: "Conversation transferred",
  unassignSuccess: "Conversation unassigned",
  assigneeColumn: "Assignee",
} as const;

export type AssignmentMessages = typeof assignmentMessagesEn;
