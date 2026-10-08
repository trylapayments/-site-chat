"use client";
import { useState, useTransition } from "react";
import { saveMyAgentProfileAction } from "@/lib/agent-profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function AgentProfileEditor({
  slug,
  initial,
}: {
  slug: string;
  initial: { name: string; avatarUrl: string | null };
}) {
  const [name, setName] = useState(initial.name);
  const [avatar, setAvatar] = useState(initial.avatarUrl);
  const [photo, setPhoto] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="max-w-xl space-y-6" data-testid="agent-profile-editor">
      <div>
        <h1 className="text-2xl font-semibold">My profile</h1>
        <p className="mt-2 text-muted-foreground">
          Your name and photo are shown to visitors when you reply.
        </p>
      </div>
      <form
        className="space-y-5 rounded-lg border bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice("");
          start(async () => {
            const form = new FormData();
            form.set("name", name);
            form.set("removePhoto", String(remove));
            if (photo) form.set("photo", photo);
            try {
              const result = await saveMyAgentProfileAction(slug, form);
              if (result.success) {
                setAvatar(result.profile.avatarUrl);
                setPhoto(null);
                setRemove(false);
                setNotice("Profile saved.");
              } else setNotice(result.message);
            } catch {
              setNotice("Unable to save your profile. Please try again.");
            }
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="agent-name">Display name</Label>
          <Input
            id="agent-name"
            value={name}
            maxLength={100}
            required
            disabled={pending}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="Your name"
          />
        </div>
        <div className="space-y-3">
          <Label htmlFor="agent-photo">Profile photo</Label>
          <div className="flex flex-wrap items-center gap-4">
            {avatar && !remove ? (
              <img
                src={avatar}
                alt="Your current profile photo"
                className="size-16 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex size-16 items-center justify-center rounded-full bg-slate-100 text-xl font-medium text-slate-600"
                aria-label="No profile photo"
              >
                {name.trim().slice(0, 1).toUpperCase() || "A"}
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                id="agent-photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={pending}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file && file.size > 2 * 1024 * 1024) {
                    setNotice("Use an image smaller than 2 MB.");
                    e.target.value = "";
                    return;
                  }
                  setPhoto(file);
                  setRemove(false);
                }}
              />
              <p className="text-xs text-muted-foreground">
                PNG, JPEG or WebP · up to 2 MB
              </p>
            </div>
          </div>
          {photo ? <p className="text-sm">Selected: {photo.name}</p> : null}
          {avatar || photo ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setPhoto(null);
                setRemove(true);
                const field = document.getElementById(
                  "agent-photo",
                ) as HTMLInputElement | null;
                if (field) field.value = "";
              }}
            >
              Remove photo
            </Button>
          ) : null}
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <p role="status" className="text-sm">
          {notice}
        </p>
      </form>
    </div>
  );
}
