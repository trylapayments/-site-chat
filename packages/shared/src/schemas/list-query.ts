import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 25;
export const ALLOWED_PAGE_SIZES = [10, 25, 50] as const;

export const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine(
        (value) => ALLOWED_PAGE_SIZES.includes(value as (typeof ALLOWED_PAGE_SIZES)[number]),
        "Invalid page size",
      )
      .default(DEFAULT_PAGE_SIZE),
    sort: z
      .string()
      .trim()
      .max(100)
      .regex(/^-?[a-z][a-z0-9_]*$/, "Sort must be a field name optionally prefixed with '-'")
      .optional(),
  })
  .strict();

export type ListQuery = z.infer<typeof listQuerySchema>;

export type ListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ParsedSort = {
  field: string;
  direction: "asc" | "desc";
};

export function parseSortParam(sort: string | undefined): ParsedSort | undefined {
  if (!sort) {
    return undefined;
  }

  if (sort.startsWith("-")) {
    return {
      field: sort.slice(1),
      direction: "desc",
    };
  }

  return {
    field: sort,
    direction: "asc",
  };
}
