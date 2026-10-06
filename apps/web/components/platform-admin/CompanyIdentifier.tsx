"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
export function CompanyIdentifier({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setFailed(false);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#747b80]">
      <span>Company ID</span>
      <code className="select-all break-all">{id}</code>
      <button
        type="button"
        onClick={() => {
          void copy();
        }}
        aria-label="Copy company ID"
        className="rounded p-1 hover:bg-[#f7f7f4]"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
      {copied || failed ? (
        <span role="status">
          {copied ? "Copied" : "Select the ID to copy it."}
        </span>
      ) : null}
    </div>
  );
}
