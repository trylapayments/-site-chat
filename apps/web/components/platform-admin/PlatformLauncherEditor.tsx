"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  uploadPlatformLauncher,
  applyPlatformLauncher,
} from "@/lib/platform-admin/launcher-actions";
export function PlatformLauncherEditor({
  workspaceId,
  version,
  hasCustomIcon,
}: {
  workspaceId: string;
  version: number;
  hasCustomIcon: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function save(reset: boolean) {
    setPending(true);
    setMessage("");
    try {
      let assetId: string | null = null;
      if (!reset) {
        if (!file) throw new Error("Choose an image.");
        const intent = await uploadPlatformLauncher(workspaceId, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        const url = new URL(intent.uploadUrl);
        if (intent.uploadToken && !url.searchParams.has("token"))
          url.searchParams.set("token", intent.uploadToken);
        const body = new FormData();
        body.append("cacheControl", "3600");
        body.append("", file, file.name);
        const response = await fetch(url, { method: "PUT", body });
        if (!response.ok) throw new Error("Image upload failed.");
        assetId = intent.assetId;
      }
      await applyPlatformLauncher(workspaceId, assetId, version, reason);
      setMessage("Published. The change is recorded in the audit log.");
      setFile(null);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save the icon.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="max-w-xl space-y-5 rounded-xl border bg-white p-6">
      <div>
        <h2 className="font-semibold">Custom launcher icon</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Managed by Mill on customer request. Applying an icon publishes it
          immediately without changing other widget settings.
        </p>
      </div>
      <p className="text-sm">
        Current icon: {hasCustomIcon ? "Custom artwork" : "Standard Mill icon"}
      </p>
      <div>
        <Label htmlFor="admin-launcher-file">Image</Label>
        <Input
          id="admin-launcher-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={pending}
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          PNG, JPEG or WebP. Maximum 512 KB and 1024 × 1024.
        </p>
      </div>
      <div>
        <Label htmlFor="admin-launcher-reason">Reason / customer request</Label>
        <Input
          id="admin-launcher-reason"
          value={reason}
          onChange={(e) => { setReason(e.target.value); }}
          disabled={pending}
        />
      </div>
      <div className="flex gap-3">
        <Button
          disabled={pending || !file || reason.trim().length < 3}
          onClick={() => {
            void save(false);
          }}
        >
          Apply icon
        </Button>
        <Button
          variant="outline"
          disabled={pending || !hasCustomIcon || reason.trim().length < 3}
          onClick={() => {
            void save(true);
          }}
        >
          Restore Mill icon
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
