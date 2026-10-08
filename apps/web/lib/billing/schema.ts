import { z } from "zod";
export const billingDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(300),
    line1: z.string().trim().max(200),
    line2: z.string().trim().max(200),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100),
    postal_code: z.string().trim().max(30),
    country: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();
export type BillingDetails = z.infer<typeof billingDetailsSchema>;
