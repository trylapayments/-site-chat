import { z } from "zod";
const text = z.string().trim().max(300).default("");
export const companyProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    legalName: text,
    website: z
      .string()
      .trim()
      .max(300)
      .refine(
        (v) => !v || /^https?:\/\//.test(v),
        "Enter an http or https website.",
      )
      .default(""),
    email: z.union([z.literal(""), z.string().email()]).default(""),
    phone: text,
    addressLine1: text,
    addressLine2: text,
    city: text,
    region: text,
    postalCode: text,
    country: z
      .union([
        z.literal(""),
        z
          .string()
          .regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. US."),
      ])
      .default(""),
    taxId: text,
  })
  .strict();
export type CompanyProfile = z.infer<typeof companyProfileSchema>;
