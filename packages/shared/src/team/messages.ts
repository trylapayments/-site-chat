/**
 * English operator strings for the Team workspace.
 * Dashboard i18n is backlog; keep labels centralized.
 */
export const teamMessagesEn = {
  pageTitle: "Team",
  pageDescription: "Members, roles, and pending invitations for this workspace.",
  memberCountOne: "1 member",
  memberCountMany: "{{count}} members",
  inviteButton: "Invite member",
  inviteTitle: "Invite member",
  inviteDescription: "Send an invitation for admin, agent, or viewer access.",
  inviteEmailLabel: "Email",
  inviteEmailPlaceholder: "name@company.com",
  inviteRoleLabel: "Role",
  inviteSubmit: "Create invitation",
  invitePendingLabel: "Invitation created",
  inviteCopyLink: "Copy invite link",
  inviteCopied: "Invite link copied",
  inviteLinkHint:
    "Copy this link and share it with the invitee. Email delivery is not sent from this screen.",
  inviteCancel: "Cancel",

  columnMember: "Member",
  columnEmail: "Email",
  columnRole: "Role",
  columnStatus: "Status",
  columnAssigned: "Assigned",
  columnJoined: "Joined",
  columnActions: "Actions",

  statusActive: "Active",
  statusInvited: "Invited",
  statusDeactivated: "Deactivated",
  youLabel: "You",

  roleOwner: "Owner",
  roleAdmin: "Admin",
  roleAgent: "Agent",
  roleViewer: "Viewer",

  assignedOne: "1 conversation",
  assignedMany: "{{count}} conversations",
  assignedNone: "None",

  loading: "Loading team…",
  loadError: "Unable to load team members.",
  emptyTitle: "No members to show",
  emptyDescription: "Workspace members appear here once they join.",
  permissionDenied: "You do not have permission to manage team members.",
  viewerNotice: "You can view the team. Inviting and role changes require an admin or owner.",

  viewMember: "View member",
  changeRole: "Change role",
  deactivate: "Deactivate",
  remove: "Remove from workspace",
  revokeInvite: "Cancel invitation",
  closeDetail: "Close",

  detailTitle: "Member",
  detailJoined: "Joined",
  detailInvited: "Invited",
  detailExpires: "Expires",
  detailAssigned: "Assigned conversations",
  detailRole: "Role",
  detailStatus: "Status",
  detailEmail: "Email",

  deactivateTitle: "Deactivate this member?",
  deactivateDescription:
    "They will lose access to this workspace. Conversations assigned to them will return to the unassigned queue.",
  deactivateConfirm: "Deactivate member",

  removeTitle: "Remove this member?",
  removeDescription:
    "They will be removed from this workspace. Conversations assigned to them will return to the unassigned queue. This cannot be undone.",
  removeConfirm: "Remove member",

  revokeTitle: "Cancel this invitation?",
  revokeDescription: "The invite link will stop working. You can send a new invitation later.",
  revokeConfirm: "Cancel invitation",

  selfActionBlocked: "You cannot change your own membership here.",
  lastOwnerBlocked: "The last owner cannot be demoted, deactivated, or removed.",
  ownerProtected: "Only another owner can change this membership.",
  deactivatedRoleBlocked:
    "Reactivate is not available. Invite this person again to restore access.",

  roleUpdated: "Role updated",
  memberDeactivated: "Member deactivated",
  memberRemoved: "Member removed",
  invitationRevoked: "Invitation cancelled",
  invitationCreated: "Invitation created",
} as const;
