"use client";

import { useRef, useState } from "react";
import { TRANSLATION_LANGUAGES } from "@site-chat/ai/client";
import { translateInPortal } from "@/lib/ai-translation/actions";

export function TranslationControl({ workspaceId, conversationId, messageId, draft, onApply }: {
  workspaceId: string; conversationId: string; messageId?: string;
  draft?: string; onApply?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ text: string; source?: string; language: string; remaining: number } | null>(null);
  const request = useRef<{ binding: string; id: string } | null>(null);
  const stale = !messageId && result?.source !== draft;
  async function translate() {
    if (busy || !consent) return;
    const source = draft;
    const binding = JSON.stringify([source, language, conversationId]);
    if (request.current?.binding !== binding)
      request.current = { binding, id: crypto.randomUUID() };
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await translateInPortal({ workspaceId,
        operation: messageId ? "translateMessage" : "previewReplyTranslation",
        input: messageId ? { conversationId, messageId, targetLanguage: language, consent: true }
          : { conversationId, text: source, targetLanguage: language, consent: true, requestId: request.current.id },
      });
      if (!response.ok) setError(response.error);
      else setResult({ text: response.result.translatedText, source, language, remaining: response.result.remaining });
    } catch { setError("Unable to translate. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 text-sm text-neutral-900">
    <button type="button" className="rounded px-2 py-1 text-brand hover:bg-blue-50 disabled:opacity-50"
      disabled={!messageId && !draft?.trim()} onClick={() => { setOpen(!open); }} aria-expanded={open}>
      {messageId ? "Translate" : "Translate reply"}
    </button>
    {open && <div className="mt-2 rounded-lg border border-blue-200 bg-white p-3 space-y-3">
      <label className="flex items-center gap-2">Translate to
        <select aria-label="Translation language" className="rounded border border-neutral-300 bg-white px-2 py-1" value={language}
          disabled={busy} onChange={e => { setLanguage(e.target.value); setResult(null); }}>
          {Object.entries(TRANSLATION_LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="flex items-start gap-2 text-xs leading-5 text-neutral-600">
        <input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); }} className="mt-1" />
        <span>Allow Mill to send this text to OpenAI for translation. The original stays unchanged.</span>
      </label>
      <button type="button" className="rounded-md bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
        disabled={busy || !consent || (!messageId && (!draft?.trim() || draft.length > 4000))} onClick={() => void translate()}>
        {busy ? "Translating…" : "Translate text"}
      </button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {result && <div aria-live="polite" className="space-y-2 border-t pt-3">
        <p className="text-xs text-neutral-500">Translation · {TRANSLATION_LANGUAGES[result.language as keyof typeof TRANSLATION_LANGUAGES]}</p>
        <p dir="auto" className="whitespace-pre-wrap">{result.text}</p>
        <p className="text-xs text-neutral-500">{result.remaining} translations remaining this month · shared across your account</p>
        {onApply && <button type="button" disabled={stale} className="rounded border px-3 py-2 disabled:opacity-50"
          onClick={() => { if (!stale) { onApply(result.text); setOpen(false); setResult(null); } }}>Use in reply</button>}
        {onApply && <p className="text-xs text-neutral-500">{stale ? "Your draft changed. Translate it again." : "Review before using. Nothing is sent automatically."}</p>}
      </div>}
    </div>}
  </div>;
}
