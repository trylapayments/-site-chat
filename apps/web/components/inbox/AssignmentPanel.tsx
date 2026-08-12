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
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

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
  const [isPending, startTransition] = useTransition();
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

  // Live assignee updates from CDC (authoritative refresh via router).
  useEffect(() => {
    const unsubscribe = subscribeOperatorConversation({
      workspaceId,
      conversationId,
      onMessageInsert: () => {
        // Assignment panel only cares about conversation row updates.
      },
      onConversationChange: (raw) => {
        const assignedTo = Reflect.get(raw, "assigned_to");
        const currentId = assignee?.member_id ?? null;
        const nextId =
          typeof assignedTo === "string"
            ? assignedTo
            : assignedTo === null
              ? null
              : currentId;
        if (nextId !== currentId) {
          router.refresh();
        }
      },
    });
    return unsubscribe;
  }, [assignee?.member_id, conversationId, router, workspaceId]);

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

  function runTake() {
    setError(null);
    const previous = assignee;
    // Optimistic: show self as assignee while request is in flight.
    if (takeDecision.action === "take" && memberId) {
      setAssignee({
        member_id: memberId,
        display_label: messages.you,
      });
    }

    startTransition(async () => {
      const result = await takeConversationAction(workspaceSlug, {
        conversationId,
        expectedVersion: assignmentVersion,
      });
      if (result.success && isAssignmentResult(result.data)) {
        applyResult(result.data, messages.takeSuccess);
        return;
      }
      // Conflict / failure: revert to authoritative server state via refresh.
      setAssignee(previous);
      if (!result.success) {
        setError(result.message);
        if (result.code === "ASSIGNMENT_CONFLICT") {
          setStatusMessage(messages.conflictRefresh);
        }
      } else {
        setError(messages.conflict);
      }
      router.refresh();
    });
  }

  function runAssign(targetMemberId: string) {
    setError(null);
    setPickerOpen(false);
    setSearch("");
    startTransition(async () => {
      const result = await assignConversationAction(workspaceSlug, {
        conversationId,
        assigneeMemberId: targetMemberId,
        expectedVersion: assignmentVersion,
      });
      if (result.success && isAssignmentResult(result.data)) {
        applyResult(
          result.data,
          hasAssignee ? messages.transferSuccess : messages.takeSuccess,
        );
        return;
      }
      setError(!result.success ? result.message : messages.genericError);
      router.refresh();
    });
  }

  function runUnassign() {
    setError(null);
    startTransition(async () => {
      const result = await unassignConversationAction(workspaceSlug, {
        conversationId,
        expectedVersion: assignmentVersion,
      });
      if (result.success && isAssignmentResult(result.data)) {
        applyResult(result.data, messages.unassignSuccess);
        return;
      }
      setError(!result.success ? result.message : messages.genericError);
      router.refresh();
    });
  }

  return (
    <section
      className="space-y-3"
      aria-labelledby="assignment-heading"
      data-testid="assignment-panel"
      data-pending={isPending ? "true" : "false"}
      data-assignee-id={assignee?.member_id ?? ""}
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
              disabled={isPending || !memberId}
              data-testid="assignment-take"
              onClick={runTake}
            >
              {isPending ? messages.taking : messages.take}
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
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
              disabled={isPending}
              data-testid="assignment-unassign"
              onClick={runUnassign}
            >
              {isPending ? messages.unassigning : messages.unassign}
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
                      disabled={isPending || isCurrent}
                      data-testid={`assignment-member-${member.member_id}`}
                      className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-60"
                      onClick={() => {
                        runAssign(member.member_id);
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
