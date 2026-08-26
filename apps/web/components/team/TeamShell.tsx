"use client";

import {
  buildTeamTableRows,
  canManageWorkspaceMembers,
  countActiveOwners,
  interpolateTeamCount,
  teamMessagesEn,
  type ListWorkspaceTeamResult,
  type MemberRole,
  type TeamInvitation,
  type TeamMember,
} from "@site-chat/shared";
import { UserCog, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/dashboard/actions/ConfirmDialog";
import { GlobalSearch } from "@/components/dashboard/global-search/GlobalSearch";
import { NotificationBell } from "@/components/dashboard/notifications/NotificationBell";
import { TeamInviteSheet } from "@/components/team/TeamInviteSheet";
import { TeamMemberSheet } from "@/components/team/TeamMemberSheet";
import { TeamTable } from "@/components/team/TeamTable";
import { Button } from "@/components/ui/button";
import { dashboardToast } from "@/lib/dashboard/toast";
import {
  deactivateWorkspaceMemberAction,
  listWorkspaceTeamAction,
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  updateWorkspaceMemberRoleAction,
} from "@/lib/team/actions";

const messages = teamMessagesEn;

type TeamDetail =
  | { kind: "member"; member: TeamMember }
  | { kind: "invitation"; invitation: TeamInvitation };

export function TeamShell({
  workspaceId,
  workspaceSlug,
  memberId,
  callerRole,
  canSearchNotes,
  initialTeam,
  loadError,
}: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  callerRole: MemberRole;
  canSearchNotes: boolean;
  initialTeam: ListWorkspaceTeamResult;
  loadError: boolean;
}) {
  const router = useRouter();
  const canManage = canManageWorkspaceMembers(callerRole);
  const [team, setTeam] = useState(initialTeam);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const mutationLockRef = useRef(false);
  const refreshGenRef = useRef(0);
  const [confirm, setConfirm] = useState<
    | { type: "deactivate"; member: TeamMember }
    | { type: "remove"; member: TeamMember }
    | { type: "revoke"; invitation: TeamInvitation }
    | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(
    loadError ? messages.loadError : null,
  );

  const rows = useMemo(
    () => buildTeamTableRows(team.members, team.invitations),
    [team.members, team.invitations],
  );
  const activeOwnerCount = countActiveOwners(team.members);
  const memberCountLabel =
    team.members.length === 1
      ? messages.memberCountOne
      : interpolateTeamCount(messages.memberCountMany, team.members.length);

  async function refreshTeam(): Promise<ListWorkspaceTeamResult | null> {
    const gen = ++refreshGenRef.current;
    const result = await listWorkspaceTeamAction(workspaceSlug);
    if (gen !== refreshGenRef.current) {
      return null;
    }
    if (!result.success) {
      setPageError(result.message);
      return null;
    }
    setTeam(result.data);
    setPageError(null);
    router.refresh();
    return result.data;
  }

  async function handleRoleChange(
    memberIdToUpdate: string,
    role: MemberRole,
  ): Promise<boolean> {
    if (mutationLockRef.current) {
      return false;
    }
    const previous = team.members.find(
      (item) => item.member_id === memberIdToUpdate,
    );
    if (!previous || previous.role === role) {
      return true;
    }
    mutationLockRef.current = true;
    setBusyId(memberIdToUpdate);
    setActionError(null);
    setTeam((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.member_id === memberIdToUpdate ? { ...item, role } : item,
      ),
    }));
    try {
      const result = await updateWorkspaceMemberRoleAction(workspaceSlug, {
        memberId: memberIdToUpdate,
        role,
      });
      if (!result.success) {
        setTeam((current) => ({
          ...current,
          members: current.members.map((item) =>
            item.member_id === memberIdToUpdate
              ? { ...item, role: previous.role }
              : item,
          ),
        }));
        setActionError(result.message);
        dashboardToast.error(result.message);
        return false;
      }
      dashboardToast.success(messages.roleUpdated);
      const next = await refreshTeam();
      if (next) {
        const updated = next.members.find(
          (item) => item.member_id === memberIdToUpdate,
        );
        if (updated) {
          setDetail((current) =>
            current?.kind === "member" &&
            current.member.member_id === memberIdToUpdate
              ? { kind: "member", member: updated }
              : current,
          );
        }
      }
      return true;
    } finally {
      mutationLockRef.current = false;
      setBusyId(null);
    }
  }

  async function handleDeactivate(memberIdToUpdate: string): Promise<boolean> {
    setBusyId(memberIdToUpdate);
    setActionError(null);
    const result = await deactivateWorkspaceMemberAction(workspaceSlug, {
      memberId: memberIdToUpdate,
    });
    setBusyId(null);
    if (!result.success) {
      setActionError(result.message);
      dashboardToast.error(result.message);
      return false;
    }
    dashboardToast.success(messages.memberDeactivated);
    await refreshTeam();
    return true;
  }

  async function handleRemove(memberIdToUpdate: string): Promise<boolean> {
    setBusyId(memberIdToUpdate);
    setActionError(null);
    const result = await removeWorkspaceMemberAction(workspaceSlug, {
      memberId: memberIdToUpdate,
    });
    setBusyId(null);
    if (!result.success) {
      setActionError(result.message);
      dashboardToast.error(result.message);
      return false;
    }
    dashboardToast.success(messages.memberRemoved);
    await refreshTeam();
    return true;
  }

  async function handleRevoke(invitationId: string): Promise<boolean> {
    setBusyId(invitationId);
    setActionError(null);
    const result = await revokeWorkspaceInvitationAction(workspaceSlug, {
      invitationId,
    });
    setBusyId(null);
    if (!result.success) {
      setActionError(result.message);
      dashboardToast.error(result.message);
      return false;
    }
    dashboardToast.success(messages.invitationRevoked);
    await refreshTeam();
    return true;
  }

  const selectedMember = detail?.kind === "member" ? detail.member : null;
  const selectedInvitation =
    detail?.kind === "invitation" ? detail.invitation : null;

  return (
    <div
      className="bg-inbox-canvas flex h-full min-h-0 w-full flex-col"
      data-testid="team-page"
    >
      <div className="border-inbox-border flex shrink-0 items-center gap-2 border-b bg-inbox-panel px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <GlobalSearch
            workspaceSlug={workspaceSlug}
            canSearchNotes={canSearchNotes}
          />
        </div>
        {memberId ? (
          <NotificationBell
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            memberId={memberId}
          />
        ) : null}
      </div>

      <div className="border-inbox-border flex shrink-0 items-start justify-between gap-4 border-b bg-inbox-panel px-5 py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="bg-brand-soft text-brand mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <UserCog className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold tracking-tight text-neutral-950">
              {messages.pageTitle}
            </h1>
            <p className="text-inbox-muted mt-0.5 text-[12.5px] leading-snug">
              {memberCountLabel}
              {team.invitations.length > 0
                ? ` · ${String(team.invitations.length)} pending`
                : ""}
            </p>
          </div>
        </div>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            data-testid="team-invite-button"
            className="bg-brand text-brand-foreground hover:bg-brand/90 h-8 shrink-0 text-[13px]"
            onClick={() => {
              setInviteOpen(true);
            }}
          >
            <UserPlus className="size-3.5" strokeWidth={1.75} />
            {messages.inviteButton}
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="text-inbox-muted border-inbox-border/70 shrink-0 border-b bg-inbox-panel px-5 py-2 text-[12.5px]">
          {messages.viewerNotice}
        </p>
      ) : null}

      {pageError ? (
        <div className="bg-inbox-panel flex flex-1 items-center justify-center p-6">
          <p className="text-destructive text-center text-sm">{pageError}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-inbox-panel flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-medium text-neutral-900">
            {messages.emptyTitle}
          </p>
          <p className="text-inbox-muted mt-1.5 max-w-sm text-[13px] leading-relaxed">
            {messages.emptyDescription}
          </p>
        </div>
      ) : (
        <div className="bg-inbox-panel flex min-h-0 flex-1 flex-col">
          <TeamTable
            rows={rows}
            callerRole={callerRole}
            callerMemberId={memberId}
            activeOwnerCount={activeOwnerCount}
            busyMemberId={busyId}
            onOpenMember={(member) => {
              setActionError(null);
              setDetail({ kind: "member", member });
              setDetailOpen(true);
            }}
            onOpenInvitation={(invitation) => {
              setActionError(null);
              setDetail({ kind: "invitation", invitation });
              setDetailOpen(true);
            }}
            onChangeRole={(id, role) => {
              void handleRoleChange(id, role);
            }}
            onDeactivate={(member) => {
              setConfirm({ type: "deactivate", member });
            }}
            onRemove={(member) => {
              setConfirm({ type: "remove", member });
            }}
            onRevoke={(invitation) => {
              setConfirm({ type: "revoke", invitation });
            }}
          />
        </div>
      )}

      <TeamInviteSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceSlug={workspaceSlug}
        callerRole={callerRole}
        onInvited={() => {
          dashboardToast.success(messages.invitationCreated);
          void refreshTeam();
        }}
      />

      <TeamMemberSheet
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setActionError(null);
          }
        }}
        member={selectedMember}
        invitation={selectedInvitation}
        callerRole={callerRole}
        callerMemberId={memberId}
        activeOwnerCount={activeOwnerCount}
        isSelf={selectedMember?.member_id === memberId}
        onChangeRole={handleRoleChange}
        onDeactivate={handleDeactivate}
        onRemove={handleRemove}
        onRevoke={handleRevoke}
        busy={busyId !== null}
        error={actionError}
      />

      <ConfirmDialog
        open={confirm?.type === "deactivate"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
        title={messages.deactivateTitle}
        description={messages.deactivateDescription}
        confirmLabel={messages.deactivateConfirm}
        variant="destructive"
        loading={busyId !== null}
        onConfirm={async () => {
          if (confirm?.type !== "deactivate") {
            return;
          }
          const ok = await handleDeactivate(confirm.member.member_id);
          if (!ok) {
            throw new Error("deactivate failed");
          }
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm?.type === "remove"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
        title={messages.removeTitle}
        description={messages.removeDescription}
        confirmLabel={messages.removeConfirm}
        variant="destructive"
        loading={busyId !== null}
        onConfirm={async () => {
          if (confirm?.type !== "remove") {
            return;
          }
          const ok = await handleRemove(confirm.member.member_id);
          if (!ok) {
            throw new Error("remove failed");
          }
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm?.type === "revoke"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
        title={messages.revokeTitle}
        description={messages.revokeDescription}
        confirmLabel={messages.revokeConfirm}
        variant="destructive"
        loading={busyId !== null}
        onConfirm={async () => {
          if (confirm?.type !== "revoke") {
            return;
          }
          const ok = await handleRevoke(confirm.invitation.invitation_id);
          if (!ok) {
            throw new Error("revoke failed");
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
