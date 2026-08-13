"use client";

import {
  assignmentMessagesEn,
  evaluateTakeDecision,
  filterAssignableMembers,
  type AssignmentMutationResult,
  type ConversationDetail,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignConversationAction,
  takeConversationAction,
  unassignConversationAction,
} from "@/lib/inbox/actions";
import { subscribeOperatorConversation } from "@/lib/realtime/operator-subscriptions";

const messages = assignmentMessagesEn;

function isAssignmentResult(data: unknown): data is AssignmentMutationResult {
  return (
    typeof data === "object" &&
    data !== null &&
    "conversation" in data &&
    "changed" in data
  );
}

export function AssignmentPanel({
  workspaceId,
  workspaceSlug,
  conversationId,
  conversation,
  members,
  memberId,
  canAssign,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  conversation: ConversationDetail;
  members: WorkspaceMemberOption[];
  memberId: string;
  canAssign: boolean;
}) {
  const router = useRouter();
  // Explicit busy flag — do not use useTransition here. router.refresh() inside
  // a transition keeps isPending true until RSC refetch completes, which can
  // strand the panel disabled after a successful mutation.
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState(conversation.assigned_to);
  const [assignmentVersion, setAssignmentVersion] = useState(
    conversation.assignment_version ?? 0,
  );
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const liveRegionId = useId();
  const takeButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAssignee(conversation.assigned_to);
    setAssignmentVersion(conversation.assignment_version ?? 0);
    setError(null);
  }, [
    conversationId,
    conversation.assigned_to,
    conversation.assignment_version,
  ]);

  // Live assignee updates from CDC. Debounced refresh avoids stacking with
  // visitor sidebar refreshes on the same page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeOperatorConversation({
      workspaceId,
      conversationId,
      onMessageInsert: () => {},
      onConversationChange: () => {
        if (timer) {
          return;
        }
        timer = setTimeout(() => {
          timer = null;
          router.refresh();
        }, 250);
      },
    });
    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [conversationId, router, workspaceId]);

  useEffect(() => {
    if (pickerOpen) {
      searchInputRef.current?.focus();
    }
  }, [pickerOpen]);

  const filteredMembers = useMemo(
    () =>
      filterAssignableMembers(members, {
        search,
        currentAssigneeMemberId: assignee?.member_id ?? null,
      }),
    [assignee?.member_id, members, search],
  );

  const takeDecision = evaluateTakeDecision(
    assignee?.member_id ?? null,
    memberId,
  );
  const hasAssignee = assignee != null;
  const assignLabel = hasAssignee ? messages.transfer : messages.assign;

  function applyResult(
    result: AssignmentMutationResult,
    successMessage: string,
  ) {
    setAssignee(result.conversation.assigned_to);
    setAssignmentVersion(result.conversation.assignment_version ?? 0);
    if (result.changed) {
      setStatusMessage(successMessage);
    }
    router.refresh();
  }

  async function runTake() {
    if (busy) {
      return;
    }
    setError(null);
    const previous = assignee;
    const versionAtClick = assignmentVersion;
    // Optimistic: show self as assignee while request is in flight.
    if (takeDecision.action === "take" && memberId) {
      setAssignee({
        member_id: memberId,
        display_label: messages.you,
      });
    }

    setBusy(true);
    try {
      const result = await takeConversationAction(workspaceSlug, {
        conversationId,
        expectedVersion: versionAtClick,
      });
      if (result.success && isAssignmentResult(result.data)) {
        applyResult(result.data, messages.takeSuccess);
        return;
      }
      // Conflict / failure: refresh to authoritative server state.
      // On ASSIGNMENT_CONFLICT do not flash Unassigned — keep optimistic
      // assignee until router.refresh() replaces it with the winner.
      if (!result.success) {
        setError(result.message);
        if (result.code === "ASSIGNMENT_CONFLICT") {
          setStatusMessage(messages.conflictRefresh);
        } else {
          setAssignee(previous);
        }
      } else {
        setAssignee(previous);
        setError(messages.conflict);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runAssign(targetMemberId: string) {
    if (busy) {
      return;
    }
    setError(null);
    setPickerOpen(false);
    setSearch("");
    const transferring = hasAssignee;
    const previous = assignee;
    const previousVersion = assignmentVersion;
    const versionAtClick = assignmentVersion;
    const target = members.find(
      (member) => member.member_id === targetMemberId,
    );
    // Optimistic: show target assignee while request is in flight.
    if (target) {
      setAssignee({
        member_id: target.member_id,
        display_label: target.display_label,
      });
    }
    setBusy(true);
    try {
      const result = await assignConversationAction(workspaceSlug, {
        conversationId,
        assigneeMemberId: targetMemberId,
        expectedVersion: versionAtClick,
      });
      if (result.success && isAssignmentResult(result.data)) {
        applyResult(
          result.data,
          transferring ? messages.transferSuccess : messages.takeSuccess,
        );
        return;
      }
      // Conflict / failure: roll back optimistic assignee, then refresh.
      setAssignee(previous);
      setAssignmentVersion(previousVersion);
      if (!result.success) {
        setError(result.message);
        if (result.code === "ASSIGNMENT_CONFLICT") {
          setStatusMessage(messages.conflictRefresh);
        }
      } else {
        setError(messages.genericError);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runUnassign() {
    if (busy) {
      return;
    }
    setError(null);
    const versionAtClick = assignmentVersion;
    setBusy(true);
    try {
      const result = await unassignConversationAction(workspaceSlug, {
        conversationId,
        expectedVersion: versionAtClick,
      });
      if (result.success && isAssignmentResult(result.data)) {
        applyResult(result.data, messages.unassignSuccess);
        return;
      }
      setError(!result.success ? result.message : messages.genericError);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3"
      aria-labelledby="assignment-heading"
      data-testid="assignment-panel"
      data-pending={busy ? "true" : "false"}
      data-assignee-id={assignee?.member_id ?? ""}
      data-assignment-version={String(assignmentVersion)}
    >
      <h2 id="assignment-heading" className="text-sm font-semibold">
        {messages.sectionTitle}
      </h2>

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">{messages.assignedTo}</p>
        <p
          className="text-sm font-medium"
          data-testid="assignment-current"
          data-assignee-id={assignee?.member_id ?? ""}
        >
          {assignee?.display_label ?? messages.unassigned}
        </p>
      </div>

      <div
        id={liveRegionId}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="assignment-live"
      >
        {statusMessage ?? error ?? ""}
      </div>

      {canAssign ? (
        <div className="flex flex-wrap gap-2">
          {takeDecision.action === "take" ? (
            <Button
              ref={takeButtonRef}
              type="button"
              size="sm"
              disabled={busy || !memberId}
              data-testid="assignment-take"
              onClick={() => {
                void runTake();
              }}
            >
              {busy ? messages.taking : messages.take}
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid="assignment-open-picker"
            aria-expanded={pickerOpen}
            aria-haspopup="listbox"
            onClick={() => {
              setPickerOpen((open) => !open);
            }}
          >
            {assignLabel}
          </Button>

          {hasAssignee ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="assignment-unassign"
              onClick={() => {
                void runUnassign();
              }}
            >
              {busy ? messages.unassigning : messages.unassign}
            </Button>
          ) : null}
        </div>
      ) : null}

      {canAssign && pickerOpen ? (
        <div
          className="space-y-2 rounded-md border p-2"
          role="dialog"
          aria-label={messages.selectAssignee}
          data-testid="assignment-picker"
        >
          <Label htmlFor="assignment-member-search" className="sr-only">
            {messages.searchMembers}
          </Label>
          <Input
            ref={searchInputRef}
            id="assignment-member-search"
            value={search}
            placeholder={messages.searchMembers}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPickerOpen(false);
                setSearch("");
              }
            }}
            autoComplete="off"
          />
          <ul
            role="listbox"
            aria-label={messages.selectAssignee}
            className="max-h-48 space-y-1 overflow-y-auto"
          >
            {filteredMembers.length === 0 ? (
              <li className="text-muted-foreground px-2 py-1.5 text-sm">
                {messages.noMembers}
              </li>
            ) : (
              filteredMembers.map((member) => {
                const isCurrent = member.member_id === assignee?.member_id;
                return (
                  <li key={member.member_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      disabled={busy || isCurrent}
                      data-testid={`assignment-member-${member.member_id}`}
                      className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-60"
                      onClick={() => {
                        void runAssign(member.member_id);
                      }}
                    >
                      <span className="font-medium">
                        {member.display_label}
                      </span>
                      {isCurrent ? (
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({messages.currentAssignee})
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {assignee &&
          !members.some((m) => m.member_id === assignee.member_id) ? (
            <p className="text-muted-foreground text-xs" role="status">
              {messages.memberUnavailable}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          className="text-destructive text-xs"
          role="alert"
          data-testid="assignment-error"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
