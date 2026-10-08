import { useState } from "react";
import {
  validatePreChatSubmission,
  type ChatSetup,
  type PreChatSubmission,
} from "@site-chat/shared";
export function PreChatForm({
  setup,
  accentColor,
  textColor,
  onSubmit,
}: {
  setup: ChatSetup;
  accentColor: string;
  textColor: string;
  onSubmit: (submission: PreChatSubmission) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const fieldStyle = {
    width: "100%",
    border: "1px solid #D7DEE3",
    borderRadius: "8px",
    padding: "0.7rem",
    fontSize: "1rem",
    color: textColor,
    background: "transparent",
    boxSizing: "border-box" as const,
  };
  const labelStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.4rem",
    fontSize: "0.875rem",
  };
  return (
    <form
      data-testid="widget-pre-chat-form"
      style={{ display: "flex", flexDirection: "column", gap: "1rem", color: textColor }}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const result = validatePreChatSubmission(setup, { requestId, name, email, phone, answers });
        if (!result.success) {
          setError(result.error.issues[0]?.message ?? "Check the form.");
          return;
        }
        setBusy(true);
        setError("");
        void onSubmit(result.data)
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Unable to submit. Please try again.");
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{setup.title}</h2>
      <p style={{ margin: 0, fontSize: "0.875rem" }}>Leave your details so our team can help.</p>
      <fieldset
        disabled={busy}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <label style={labelStyle}>
          Your name{setup.requireName ? " *" : ""}
          <input
            autoComplete="name"
            style={fieldStyle}
            value={name}
            required={setup.requireName}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <label style={labelStyle}>
          Email address{setup.requireEmail ? " *" : ""}
          <input
            type="email"
            autoComplete="email"
            style={fieldStyle}
            value={email}
            required={setup.requireEmail}
            maxLength={254}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>
        {setup.showPhone ? (
          <label style={labelStyle}>
            Phone number
            <input
              type="tel"
              autoComplete="tel"
              style={fieldStyle}
              value={phone}
              maxLength={50}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </label>
        ) : null}
        {setup.fields.map((field) => {
          const value = answers[field.id];
          const change = (next: string | boolean) => {
            setAnswers((current) => ({ ...current, [field.id]: next }));
          };
          return (
            <label key={field.id} style={labelStyle}>
              {field.label}
              {field.required ? " *" : ""}
              {field.type === "select" ? (
                <select
                  style={fieldStyle}
                  value={typeof value === "string" ? value : ""}
                  required={field.required}
                  onChange={(event) => {
                    change(event.target.value);
                  }}
                >
                  <option value="">Choose an option</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={value === true}
                  required={field.required}
                  onChange={(event) => {
                    change(event.target.checked);
                  }}
                />
              ) : field.type === "textarea" ? (
                <textarea
                  style={fieldStyle}
                  rows={3}
                  required={field.required}
                  maxLength={2000}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => {
                    change(event.target.value);
                  }}
                />
              ) : (
                <input
                  style={fieldStyle}
                  type={field.type === "phone" ? "tel" : field.type}
                  required={field.required}
                  maxLength={2000}
                  step={field.type === "number" ? "any" : undefined}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => {
                    change(event.target.value);
                  }}
                />
              )}
            </label>
          );
        })}
        <button
          type="submit"
          style={{
            border: 0,
            borderRadius: "8px",
            background: accentColor,
            color: "white",
            padding: "0.8rem",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          {busy ? "Sending…" : "Start conversation"}
        </button>
      </fieldset>
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: "0.875rem" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
