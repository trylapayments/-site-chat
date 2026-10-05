"use client";
import {
  chatSetupSchema,
  type ChatSetup,
  type PreChatField,
} from "@site-chat/shared";
import { useEffect, useState, useTransition } from "react";
import { saveChatSetupAction } from "@/lib/chat-setup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const fieldTypes: { value: PreChatField["type"]; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];
export function ChatSetupEditor({
  slug,
  initial,
  canManage,
  workspaceName,
}: {
  slug: string;
  workspaceName: string;
  initial: { config: ChatSetup; version: number };
  canManage: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const [draft, setDraft] = useState(initial.config);
  const [saved, setSaved] = useState(initial.config);
  const [version, setVersion] = useState(initial.version);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const update = (change: Partial<ChatSetup>) => {
    setDraft((current) => ({ ...current, ...change }));
    setNotice("");
  };
  const editField = (id: string, change: Partial<PreChatField>) => {
    update({
      fields: draft.fields.map((field) =>
        field.id === id ? { ...field, ...change } : field,
      ),
    });
  };
  const move = (index: number, direction: number) => {
    const fields = [...draft.fields];
    const other = index + direction;
    if (other < 0 || other >= fields.length) return;
    const currentField = fields[index];
    const otherField = fields[other];
    if (!currentField || !otherField) return;
    [fields[index], fields[other]] = [otherField, currentField];
    update({ fields });
  };
  const valid = chatSetupSchema.safeParse(draft);
  const disabled = !canManage || pending || !hydrated;
  return (
    <div className="space-y-6" data-testid="chat-setup-editor">
      <div>
        <h1 className="text-2xl font-semibold">Chat setup</h1>
        <p className="text-muted-foreground mt-2">
          Choose how visitors start a conversation with your team.
        </p>
      </div>
      <section
        className="space-y-4 rounded-lg border bg-white p-5"
        aria-labelledby="composer-tools-title"
      >
        <h2 id="composer-tools-title" className="text-lg font-semibold">
          Visitor message tools
        </h2>
        <p className="text-sm text-muted-foreground">
          Help visitors start a conversation. All three tools are enabled by
          default.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.quickQuestionsEnabled}
            disabled={disabled}
            onChange={(e) => {
              update({ quickQuestionsEnabled: e.target.checked });
            }}
          />{" "}
          Show quick questions
        </label>
        <label className="block text-sm font-medium" htmlFor="quick-questions">
          Quick questions (one per line)
        </label>
        <textarea
          id="quick-questions"
          rows={4}
          value={draft.quickQuestions.join("\n")}
          disabled={disabled}
          className="w-full rounded-md border p-3 text-sm"
          onChange={(e) => {
            update({ quickQuestions: e.target.value.split("\n") });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Up to 8 questions, 120 characters each. Clicking a question sends it
          as the visitor’s first message. Questions disappear once the visitor
          sends a message.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.emojiEnabled}
            disabled={disabled}
            onChange={(e) => {
              update({ emojiEnabled: e.target.checked });
            }}
          />{" "}
          Enable emoji picker
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.voiceMessagesEnabled}
            disabled={disabled}
            onChange={(e) => {
              update({ voiceMessagesEnabled: e.target.checked });
            }}
          />{" "}
          Enable voice messages
        </label>
        <p className="text-xs text-muted-foreground">
          Visitors can record up to 2 minutes, review the recording and send it.
          Microphone access is requested only when they press Record.
        </p>
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form
          className="space-y-6 rounded-lg border bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid.success) return;
            startTransition(async () => {
              const result = await saveChatSetupAction(slug, {
                config: draft,
                version,
              });
              if (result.success) {
                setVersion(result.version);
                setSaved(draft);
                setNotice("Settings saved.");
              } else setNotice(result.message);
            });
          }}
        >
          <fieldset disabled={disabled} className="space-y-6">
            <h2 className="text-lg font-semibold">Pre-chat form</h2>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => {
                  update({ enabled: event.target.checked });
                }}
              />
              Ask visitors to fill in a form before chatting
            </label>
            <p className="text-muted-foreground text-sm">
              The team is notified after the visitor submits the form.
            </p>
            <div className="space-y-2">
              <Label htmlFor="pre-chat-title">Form title</Label>
              <Input
                id="pre-chat-title"
                value={draft.title}
                maxLength={150}
                onChange={(event) => {
                  update({ title: event.target.value });
                }}
              />
            </div>
            <div className="space-y-3">
              {(
                [
                  ["requireName", "Name required"],
                  ["requireEmail", "Email required"],
                  ["showPhone", "Show optional phone field"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(event) => {
                      update({ [key]: event.target.checked });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Custom fields</h2>
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.fields.length >= 20}
                  onClick={() => {
                    update({
                      fields: [
                        ...draft.fields,
                        {
                          id: crypto.randomUUID(),
                          label: "New field",
                          type: "text",
                          required: false,
                          options: [],
                        },
                      ],
                    });
                  }}
                >
                  Add field
                </Button>
              </div>
              {draft.fields.map((field, index) => (
                <div
                  key={field.id}
                  className="space-y-3 rounded-lg border p-4"
                  data-testid="pre-chat-custom-field"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`field-label-${field.id}`}>
                        Field label
                      </Label>
                      <Input
                        id={`field-label-${field.id}`}
                        value={field.label}
                        maxLength={100}
                        onChange={(event) => {
                          editField(field.id, { label: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`field-type-${field.id}`}>
                        Field type
                      </Label>
                      <select
                        id={`field-type-${field.id}`}
                        className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                        value={field.type}
                        onChange={(event) => {
                          editField(field.id, {
                            type: event.target.value as PreChatField["type"],
                            options:
                              event.target.value === "select" &&
                              field.options.length < 2
                                ? ["Option 1", "Option 2"]
                                : field.options,
                          });
                        }}
                      >
                        {fieldTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {field.type === "select" ? (
                    <div className="space-y-2">
                      <Label htmlFor={`field-options-${field.id}`}>
                        Choices (one per line)
                      </Label>
                      <textarea
                        id={`field-options-${field.id}`}
                        className="min-h-24 w-full rounded-md border p-3 text-sm"
                        value={field.options.join("\n")}
                        onChange={(event) => {
                          editField(field.id, {
                            options: event.target.value.split("\n"),
                          });
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => {
                          editField(field.id, {
                            required: event.target.checked,
                          });
                        }}
                      />
                      Required
                    </label>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        aria-label={`Move ${field.label} up`}
                        onClick={() => {
                          move(index, -1);
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === draft.fields.length - 1}
                        aria-label={`Move ${field.label} down`}
                        onClick={() => {
                          move(index, 1);
                        }}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${field.label}`}
                        onClick={() => {
                          update({
                            fields: draft.fields.filter(
                              (item) => item.id !== field.id,
                            ),
                          });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-muted-foreground text-xs">
                Up to 20 custom fields. Answers are saved with the conversation.
              </p>
            </div>
            {(
              [
                ["waitingMessage", "Waiting message"],
                [
                  "offlineWaitingMessage",
                  "Waiting message when operators are unavailable",
                ],
                ["invitationMessage", "Standard chat invitation"],
              ] as const
            ).map(([key, label]) => (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`chat-${key}`}>{label}</Label>
                <textarea
                  id={`chat-${key}`}
                  className="min-h-24 w-full rounded-md border p-3 text-sm"
                  maxLength={key === "invitationMessage" ? 1000 : 500}
                  value={draft[key]}
                  onChange={(event) => {
                    update({ [key]: event.target.value });
                  }}
                />
              </div>
            ))}
            <section className="space-y-3 border-t pt-5">
              <h2 className="text-lg font-semibold">Read receipts</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.showReadReceipts}
                  onChange={(event) => {
                    update({ showReadReceipts: event.target.checked });
                  }}
                />
                Show read receipts to visitors
              </label>
              <p className="text-muted-foreground text-sm">
                Off by default. Visitors see one checkmark confirming their
                message was sent. Enable this to show delivery and read
                confirmation from operators.
              </p>
            </section>
            <section className="space-y-4 border-t pt-5">
              <h2 className="text-lg font-semibold">
                When the team is unavailable
              </h2>
              <p className="text-muted-foreground text-sm">
                Let visitors leave a message, or hide the widget entirely. Away
                operators do not count as Offline.
              </p>
              {(
                [
                  ["allOfflineBehavior", "When all operators are Offline"],
                  ["outsideHoursBehavior", "Outside working hours"],
                ] as const
              ).map(([key, label]) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <select
                    id={key}
                    className="w-full rounded-md border bg-white p-2 text-sm"
                    value={draft[key]}
                    onChange={(event) => {
                      update({ [key]: event.target.value });
                    }}
                  >
                    <option value="message">
                      Allow visitors to leave a message
                    </option>
                    <option value="hide">Hide the widget</option>
                  </select>
                </div>
              ))}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.workingHours.enabled}
                  onChange={(event) => {
                    update({
                      workingHours: {
                        ...draft.workingHours,
                        enabled: event.target.checked,
                      },
                    });
                  }}
                />
                Use working hours
              </label>
              <div className="space-y-2">
                <Label htmlFor="working-timezone">Timezone</Label>
                <Input
                  id="working-timezone"
                  value={draft.workingHours.timezone}
                  placeholder="America/New_York"
                  onChange={(event) => {
                    update({
                      workingHours: {
                        ...draft.workingHours,
                        timezone: event.target.value,
                      },
                    });
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Use an IANA timezone, such as America/New_York or
                  America/Los_Angeles. Daylight saving time is handled
                  automatically.
                </p>
              </div>
              <div className="space-y-3">
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day, index) => {
                  const row = draft.workingHours.weekly.find(
                    (entry) => entry.day === index,
                  );
                  const change = (next: typeof row) => {
                    update({
                      workingHours: {
                        ...draft.workingHours,
                        weekly: [
                          ...draft.workingHours.weekly.filter(
                            (entry) => entry.day !== index,
                          ),
                          ...(next ? [next] : []),
                        ],
                      },
                    });
                  };
                  return (
                    <div
                      key={day}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <label className="flex w-32 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`${day} open`}
                          checked={!!row}
                          onChange={(event) => {
                            change(
                              event.target.checked
                                ? { day: index, start: "09:00", end: "17:00" }
                                : undefined,
                            );
                          }}
                        />
                        {day}
                      </label>
                      {row ? (
                        <>
                          <input
                            type="time"
                            aria-label={`${day} start`}
                            className="rounded-md border p-2 text-sm"
                            value={row.start}
                            onChange={(event) => {
                              change({ ...row, start: event.target.value });
                            }}
                          />
                          <span>–</span>
                          <input
                            type="time"
                            aria-label={`${day} end`}
                            className="rounded-md border p-2 text-sm"
                            value={row.end}
                            onChange={(event) => {
                              change({ ...row, end: event.target.value });
                            }}
                          />
                        </>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          Closed
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            {!valid.success ? (
              <p role="alert" className="text-destructive text-sm">
                {valid.error.issues[0]?.message}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={
                !valid.success ||
                JSON.stringify(saved) === JSON.stringify(draft)
              }
            >
              {" "}
              {pending ? "Saving…" : "Save settings"}{" "}
            </Button>
          </fieldset>
          {notice ? (
            <p role="status" className="text-sm">
              {notice}
            </p>
          ) : null}
        </form>
        <div className="space-y-4 rounded-lg bg-muted p-5">
          <h2 className="font-semibold">Widget preview</h2>
          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="bg-[#1F3A4C] p-5 text-white">{workspaceName}</div>
            <div className="space-y-3 p-5">
              {draft.enabled ? (
                <>
                  <h3 className="font-semibold">{draft.title}</h3>
                  <Input
                    aria-label="Preview name"
                    placeholder={`Your name${draft.requireName ? " *" : ""}`}
                  />
                  <Input
                    aria-label="Preview email"
                    placeholder={`Email address${draft.requireEmail ? " *" : ""}`}
                  />
                  {draft.showPhone ? (
                    <Input
                      aria-label="Preview phone"
                      placeholder="Phone number"
                    />
                  ) : null}
                  {draft.fields.map((field) => (
                    <div className="space-y-1" key={field.id}>
                      <p className="text-sm">
                        {field.label}
                        {field.required ? " *" : ""}
                      </p>
                      {field.type === "select" ? (
                        <select
                          aria-label={`Preview ${field.label}`}
                          className="h-9 w-full rounded-md border bg-white px-2"
                        >
                          <option>Choose an option</option>
                          {field.options.map((option, i) => (
                            <option key={i}>{option}</option>
                          ))}
                        </select>
                      ) : field.type === "checkbox" ? (
                        <input
                          aria-label={`Preview ${field.label}`}
                          type="checkbox"
                        />
                      ) : field.type === "textarea" ? (
                        <textarea
                          aria-label={`Preview ${field.label}`}
                          className="w-full rounded border p-2"
                        />
                      ) : (
                        <Input
                          aria-label={`Preview ${field.label}`}
                          type={field.type === "phone" ? "tel" : field.type}
                        />
                      )}
                    </div>
                  ))}
                  <Button type="button" className="w-full">
                    Start conversation
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Visitors can send a message immediately.
                </p>
              )}
              <p className="rounded bg-muted p-3 text-center text-xs text-muted-foreground">
                {draft.waitingMessage}
              </p>
            </div>
            <p className="pb-3 text-center text-xs text-muted-foreground">
              Powered by Mill
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
