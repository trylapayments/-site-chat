"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TRANSLATION_LANGUAGES, type TranslationLanguage } from "@site-chat/ai/client";
import { loadOperatorReplyOriginals, translateInPortal } from "@/lib/ai-translation/portal-client";

type Preferences = { enabled: boolean; language: string; replyLanguage: string; consent: boolean; replies: boolean; shareOriginal: boolean };
const defaults: Preferences = { enabled: false, language: "auto", replyLanguage: "auto", consent: false, replies: true, shareOriginal: false };
function supported(code: string): code is TranslationLanguage { return Object.hasOwn(TRANSLATION_LANGUAGES, code); }
export function translationLanguageName(code: string) {
  if (code === "und") return "Source language unknown";
  return supported(code) ? TRANSLATION_LANGUAGES[code] : code.toUpperCase();
}
const Context = createContext<{
  originals: Record<string, { original: string; translated: string; sourceLanguage: string; targetLanguage: string }>;
  rememberOriginal: (id: string, value: { original: string; translated: string; sourceLanguage: string; targetLanguage: string }) => void;
  identity: string; prefs: Preferences; target: TranslationLanguage; customerLanguage: string | null;
  setCustomerLanguage: (language: string) => void;
} | null>(null);
export function useConversationTranslation() { return useContext(Context); }

export function ConversationTranslationProvider({ children, identity, workspaceId, conversationId, messageVersion }: { children: ReactNode; identity: string; workspaceId: string; conversationId: string; messageVersion: string }) {
  const key = `mill.translation.v2.${identity}`;
  const [originals, setOriginals] = useState<Record<string, { original: string; translated: string; sourceLanguage: string; targetLanguage: string }>>({});
  const rememberOriginal = useMemo(() => (id: string, value: { original: string; translated: string; sourceLanguage: string; targetLanguage: string }) => { setOriginals(current => ({ ...current, [id]: value })); }, []);
  useEffect(() => { let cancelled = false; void loadOperatorReplyOriginals({ workspaceId, conversationId }).then(result => { if (!cancelled && result.ok) setOriginals(current => ({ ...result.originals, ...current })); }).catch(() => {}); return () => { cancelled = true; }; }, [workspaceId, conversationId, messageVersion]);
  const [prefs, setPrefs] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [customerLanguage, setCustomerLanguage] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    setPrefs(defaults);
    try { const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Preferences> | null;
      if (saved && typeof saved.enabled === "boolean" && typeof saved.consent === "boolean" && (saved.language === "auto" || supported(String(saved.language))) && (saved.replyLanguage === "auto" || supported(String(saved.replyLanguage))))
        setPrefs({ enabled: saved.enabled && saved.consent, consent: saved.consent, language: String(saved.language), replyLanguage: String(saved.replyLanguage), replies: saved.replies !== false, shareOriginal: false });
    } catch { /* Storage is optional. */ }
    setReady(true);
  }, [key]);
  function update(next: Preferences) { setPrefs(next); try { localStorage.setItem(key, JSON.stringify({ ...next, shareOriginal: false })); } catch { /* Session still works. */ } }
  const browserLanguage = typeof navigator === "undefined" ? "en" : navigator.language.split("-")[0] ?? "en";
  const target = supported(prefs.language) ? prefs.language : supported(browserLanguage) ? browserLanguage : "en";
  const value = useMemo(() => ({ originals, rememberOriginal, identity, prefs, target, customerLanguage, setCustomerLanguage }), [originals, rememberOriginal, identity, prefs, target, customerLanguage]);
  return <Context.Provider value={value}><div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-inbox-border bg-inbox-surface px-4 py-2 text-xs text-neutral-600">
      <button type="button" disabled={!ready} aria-expanded={settings} className="rounded-md border border-inbox-border px-2.5 py-1.5 hover:bg-blue-50" onClick={() => { setSettings(!settings); }}>
        Translation {prefs.enabled ? `on · ${translationLanguageName(target)}` : "off"}
      </button>
      {prefs.enabled && <button type="button" className="rounded-md border px-2 py-1.5" onClick={() => { update({ ...prefs, replies: !prefs.replies }); }}>{prefs.replies ? "Replies: translated" : "Replies: original"}</button>}
      {prefs.enabled && <button type="button" className="rounded-md px-2 py-1.5 underline" onClick={() => { update({ ...prefs, enabled: false }); }}>Turn off translation</button>}
      {prefs.enabled && prefs.replies && <span>Replies → {prefs.replyLanguage === "auto" ? customerLanguage ? translationLanguageName(customerLanguage) : "detecting customer language" : translationLanguageName(prefs.replyLanguage)}</span>}
    </div>
    {settings && <div className="shrink-0 border-b border-inbox-border bg-inbox-surface px-4 py-3 text-xs space-y-3">
      {!prefs.consent && <p>Enable automatic translation? Conversation text and replies will be sent to OpenAI. Original incoming messages stay unchanged.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label>My language <select aria-label="My translation language" className="ml-2 rounded border bg-white p-1.5" value={prefs.language} onChange={e => { update({ ...prefs, language: e.target.value }); }}>
          <option value="auto">Automatic (browser language)</option>{Object.entries(TRANSLATION_LANGUAGES).map(([code,name]) => <option key={code} value={code}>{name}</option>)}
        </select></label>
        <label>Send replies in <select aria-label="Reply translation language" className="ml-2 rounded border bg-white p-1.5" value={prefs.replyLanguage} onChange={e => { update({ ...prefs, replyLanguage: e.target.value }); }}>
          <option value="auto">Automatic (customer language)</option>{Object.entries(TRANSLATION_LANGUAGES).map(([code,name]) => <option key={code} value={code}>{name}</option>)}
        </select></label>
        <button type="button" className="rounded-md bg-blue-600 px-3 py-1.5 text-white" onClick={() => { update({ ...prefs, enabled: !prefs.enabled, consent: true }); setSettings(false); }}>
          {prefs.enabled ? "Turn off" : prefs.consent ? "Turn on" : "Agree and turn on"}
        </button>
        {prefs.consent && <button type="button" className="underline" onClick={() => { update({ ...prefs, enabled: false, consent: false }); }}>Withdraw permission</button>}
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.shareOriginal} onChange={e => { update({ ...prefs, shareOriginal: e.target.checked }); }} />Show original to customer alongside the translation</label>
      <p className="text-neutral-500">New messages translate automatically. Send translates your reply once, then delivers it. Settings are saved for this operator in this browser.</p>
    </div>}
    {children}
  </div></Context.Provider>;
}

// Bound concurrency and share in-flight work; opening a thread cannot flood the provider.
let active = 0;
let scheduled = false;
const queue: Array<{ priority: number; run: () => void }> = [];
const cached = new Map<string, Promise<Awaited<ReturnType<typeof translateInPortal>>>>();
function pump() {
  queue.sort((a,b) => b.priority - a.priority);
  while (active < 2 && queue.length) queue.shift()?.run();
}
function queuedTranslation(key: string, input: Parameters<typeof translateInPortal>[0], allowed: () => boolean, priority: number) {
  const found = cached.get(key); if (found) return found;
  const promise = new Promise<Awaited<ReturnType<typeof translateInPortal>>>((resolve, reject) => {
    queue.push({ priority, run: () => {
      if (!allowed()) { reject(new Error("Translation disabled")); return; }
      active++;
      void translateInPortal(input).then(resolve, reject).finally(() => { active--; pump(); });
    } });
    // Collect this render's message requests before dispatching; newest first.
    if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; pump(); }); }
  });
  cached.set(key, promise);
  void promise.then(result => { if (!result.ok) cached.delete(key); }, () => { cached.delete(key); });
  if (cached.size > 200) cached.delete(cached.keys().next().value as string);
  return promise;
}
export function InlineTranslation({ workspaceId, conversationId, messageId, original, latest }: {
  workspaceId: string; conversationId: string; messageId: string; original: string; latest: boolean;
}) {
  const context = useConversationTranslation();
  const [result, setResult] = useState<{ text: string; sourceLanguage: string } | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const latestRef = useRef(latest);
  latestRef.current = latest;
  const identity = context?.identity ?? "";
  const enabled = context?.prefs.enabled ?? false;
  const target = context?.target ?? "en";
  const setCustomerLanguage = context?.setCustomerLanguage;
  useEffect(() => {
    const current = ++generation.current;
    setResult(null); setError("");
    if (!enabled) return;
    if (original.length > 4000) { setError("This message is too long to translate."); return; }
    const key = JSON.stringify([identity, workspaceId, conversationId, messageId, target]);
    void queuedTranslation(key, { workspaceId, operation: "translateMessage", input: { conversationId, messageId, targetLanguage: target, consent: true } }, () => generation.current === current, latestRef.current ? 100 : 0).then(response => {
      if (generation.current !== current) return;
      if (!response.ok) { setError(response.error); return; }
      const sourceLanguage = response.result.sourceLanguage ?? "und";
      setResult({ text: response.result.translatedText, sourceLanguage });
      if (latestRef.current && supported(sourceLanguage)) setCustomerLanguage?.(sourceLanguage);
    }).catch(() => { if (generation.current === current) setError("Translation unavailable. Original message is shown."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This ref is a request generation counter, not a DOM node.
    return () => { generation.current++; };
  }, [identity, enabled, workspaceId, conversationId, messageId, original, target, setCustomerLanguage]);
  if (!enabled) return null;
  return <div className="mt-2 border-t border-neutral-200 pt-2 text-xs text-neutral-500" aria-live="polite">
    {result ? <><p className="mb-1 text-[10px]">{translationLanguageName(result.sourceLanguage)} → {translationLanguageName(target)}</p><p dir="auto" className="whitespace-pre-wrap leading-relaxed">{result.text}</p></> : <p>{error || "Translating…"}</p>}
  </div>;
}
