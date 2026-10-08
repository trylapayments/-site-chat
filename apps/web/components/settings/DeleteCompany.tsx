"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCompanyAction } from "@/lib/company/actions";
export function DeleteCompany({ slug, name }: { slug: string; name: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <section className="rounded-xl border border-red-200 bg-white p-6">
      <h2 className="font-semibold">Delete company</h2>
      <p className="mt-2 text-sm text-inbox-muted">
        Remove this company and its websites from your account. Your email and
        login account will stay active. Cancel any subscription in Billing
        first.
      </p>
      <label className="mt-4 block text-sm">
        Type <strong>{name}</strong> to confirm
        <input
          className="mt-2 block w-full rounded-md border px-3 py-2"
          value={confirmation}
          onChange={(e) => {
            setConfirmation(e.target.value);
          }}
        />
      </label>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        disabled={pending || confirmation !== name}
        onClick={() => {
          setPending(true);
          void deleteCompanyAction(slug, confirmation)
            .then((result) => {
              if (result.success) {
                router.replace("/app");
                router.refresh();
              } else {
                setError(result.message);
                setPending(false);
              }
            })
            .catch(() => {
              setError("Unable to delete company.");
              setPending(false);
            });
        }}
      >
        {pending ? "Deleting…" : "Delete company"}
      </button>
    </section>
  );
}
