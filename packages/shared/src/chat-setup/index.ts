import { z } from "zod";

export const preChatFieldSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "textarea", "email", "phone", "number", "select", "checkbox"]),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.type === "select" && field.options.length < 2)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Add at least two choices.",
      });
    if (new Set(field.options).size !== field.options.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Choices must be unique.",
      });
  });
export const chatSetupSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().trim().min(1).max(150).default("Let's get you connected"),
    requireName: z.boolean().default(true),
    requireEmail: z.boolean().default(true),
    showPhone: z.boolean().default(false),
    fields: z.array(preChatFieldSchema).max(20).default([]),
    waitingMessage: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .default("We've notified our team. An operator will join you shortly."),
    offlineWaitingMessage: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .default("We've notified our team. We'll reply as soon as we're available."),
    invitationMessage: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .default("Hi! Can I help you find the right service?"),
  })
  .strict()
  .superRefine((setup, ctx) => {
    if (new Set(setup.fields.map((field) => field.id)).size !== setup.fields.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Field IDs must be unique.",
      });
  });
export type ChatSetup = z.infer<typeof chatSetupSchema>;
export type PreChatField = z.infer<typeof preChatFieldSchema>;
export const defaultChatSetup: ChatSetup = chatSetupSchema.parse({});
export const preChatSubmissionSchema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().trim().max(200).default(""),
    email: z.string().trim().max(254).default(""),
    phone: z.string().trim().max(50).default(""),
    answers: z.record(z.string().uuid(), z.union([z.string().max(2000), z.boolean()])).default({}),
  })
  .strict();
export type PreChatSubmission = z.infer<typeof preChatSubmissionSchema>;
/** Validate the current server configuration, never a visitor-supplied form. */
export function validatePreChatSubmission(setup: ChatSetup, input: unknown) {
  return preChatSubmissionSchema
    .superRefine((submission, ctx) => {
      const issue = (path: (string | number)[], message: string) => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      };
      if (setup.requireName && !submission.name) issue(["name"], "Enter your name.");
      if (
        (setup.requireEmail || submission.email) &&
        !z.string().email().safeParse(submission.email).success
      )
        issue(["email"], "Enter a valid email address.");
      if (!setup.showPhone && submission.phone) issue(["phone"], "Phone field is not enabled.");
      const ids = new Set(setup.fields.map((field) => field.id));
      for (const id of Object.keys(submission.answers))
        if (!ids.has(id))
          issue(["answers", id], "This field is no longer available. Please reload the form.");
      for (const field of setup.fields) {
        const value = submission.answers[field.id];
        const text = typeof value === "string" ? value.trim() : "";
        if (field.type === "checkbox") {
          if (value !== undefined && typeof value !== "boolean")
            issue(["answers", field.id], "Select a valid checkbox value.");
          if (field.required && value !== true)
            issue(["answers", field.id], "This checkbox is required.");
          continue;
        }
        if (value !== undefined && typeof value !== "string")
          issue(["answers", field.id], "Enter a valid value.");
        if (!text) {
          if (field.required) issue(["answers", field.id], `${field.label} is required.`);
          continue;
        }
        if (field.type === "email" && !z.string().email().safeParse(text).success)
          issue(["answers", field.id], "Enter a valid email address.");
        if (
          field.type === "number" &&
          (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text)))
        )
          issue(["answers", field.id], "Enter a valid number.");
        if (field.type === "select" && !field.options.includes(text))
          issue(["answers", field.id], "Choose an available option.");
      }
    })
    .safeParse(input);
}
