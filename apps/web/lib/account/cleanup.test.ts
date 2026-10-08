import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  read: vi.fn(),
  remove:
    vi.fn<
      (
        bucket: string,
        paths: string[],
      ) => Promise<{ error: { message: string } | null }>
    >(),
  finish: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({ order: () => ({ limit: mocks.read }) }),
      delete: () => ({ in: mocks.finish }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => mocks.remove(bucket, paths),
      }),
    },
  }),
}));
import { processAccountDeletionCleanup } from "./cleanup";
const jobs = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    bucket: "agent-avatars",
    path: "fixture/avatar.png",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    bucket: "attachments",
    path: "fixture/photo.jpg",
  },
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: { pending: false }, error: null });
  mocks.read.mockResolvedValue({ data: jobs, error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.finish.mockResolvedValue({ error: null });
});
it("removes files through their own bucket then acknowledges only that batch", async () => {
  expect(await processAccountDeletionCleanup()).toEqual({
    removed: 2,
    pending: false,
  });
  expect(mocks.read).toHaveBeenCalledWith(100);
  expect(mocks.remove).toHaveBeenCalledWith("agent-avatars", [
    "fixture/avatar.png",
  ]);
  expect(mocks.remove).toHaveBeenCalledWith("attachments", [
    "fixture/photo.jpg",
  ]);
  expect(mocks.finish).toHaveBeenCalledWith("id", [jobs[0].id]);
  expect(mocks.finish).toHaveBeenCalledWith("id", [jobs[1].id]);
});
it("keeps failed storage jobs for retry while processing other buckets", async () => {
  mocks.remove.mockImplementation((bucket) =>
    Promise.resolve({
      error: bucket === "attachments" ? { message: "temporary" } : null,
    }),
  );
  expect(await processAccountDeletionCleanup()).toEqual({
    removed: 1,
    pending: true,
  });
  expect(mocks.finish).toHaveBeenCalledTimes(1);
  expect(mocks.finish).toHaveBeenCalledWith("id", [jobs[0].id]);
});
it("keeps jobs if file removal succeeds but acknowledgement fails", async () => {
  mocks.finish.mockResolvedValue({ error: { message: "temporary" } });
  expect(await processAccountDeletionCleanup()).toEqual({
    removed: 0,
    pending: true,
  });
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});
it("bounds database cleanup to four batches per scheduler invocation", async () => {
  mocks.rpc.mockResolvedValue({ data: { pending: true }, error: null });
  expect((await processAccountDeletionCleanup()).pending).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledTimes(4);
});
it("does not lose queued files when company cleanup fails", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "temporary" } });
  expect(await processAccountDeletionCleanup()).toEqual({
    removed: 2,
    pending: true,
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("does not acknowledge anything when reading the queue fails", async () => {
  mocks.read.mockResolvedValue({ data: null, error: { message: "temporary" } });
  expect(await processAccountDeletionCleanup()).toEqual({
    removed: 0,
    pending: true,
  });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.finish).not.toHaveBeenCalled();
});
