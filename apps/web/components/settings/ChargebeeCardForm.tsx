"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  startChargebeeCardAction,
  completeChargebeeCardAction,
} from "@/lib/billing/actions";
type PaymentComponent = {
  mount: (target: HTMLElement) => Promise<boolean>;
  validate: () => Promise<boolean>;
  confirm: () => Promise<void>;
  close: () => void;
};
type ChargebeeSdk = {
  init: (config: { site: string; publishableKey: string }) => {
    components: (options: object) => {
      create: (
        kind: "payment",
        options: object,
        callbacks: {
          onSuccess: (intent: { id: string }) => void;
          onError: () => void;
        },
      ) => PaymentComponent;
    };
  };
};
let sdkPromise: Promise<ChargebeeSdk> | null = null;
export function preloadChargebeeSdk() {
  void loadSdk().catch(() => {
    /* The form presents load errors when opened. */
  });
}
function loadSdk() {
  sdkPromise ??= new Promise<ChargebeeSdk>((resolve, reject) => {
    const sdk = () =>
      (window as unknown as { Chargebee?: ChargebeeSdk }).Chargebee;
    const existing = sdk();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.chargebee.com/v2/chargebee.js";
    script.onload = () => {
      const value = sdk();
      if (value) resolve(value);
      else reject(new Error("Payment form unavailable"));
    };
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Payment form unavailable"));
    };
    document.head.append(script);
  });
  return sdkPromise;
}
export function ChargebeeCardForm({
  slug,
  config,
  onClose,
}: {
  slug: string;
  config: { site: string; publishableKey: string };
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const component = useRef<PaymentComponent | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const router = useRouter();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const lifecycle = { disposed: false };
    const isDisposed = () => lifecycle.disposed;
    let mounted: PaymentComponent | null = null;
    void (async () => {
      try {
        const [sdk, setup] = await Promise.all([
          loadSdk(),
          startChargebeeCardAction(slug),
        ]);
        if (isDisposed()) return;
        if (!setup.success) {
          setMessage(setup.message);
          return;
        }
        const cb = sdk.init({
          site: config.site,
          publishableKey: config.publishableKey,
        });
        mounted = cb.components({ locale: "en" }).create(
          "payment",
          {
            paymentIntent: { id: setup.paymentIntent.id },
            paymentMethods: { sortOrder: ["card"] },
          },
          {
            onError: () => {
              if (!isDisposed()) {
                setPending(false);
                setMessage(
                  "Card verification failed. Please check your details and try again.",
                );
              }
            },
            onSuccess: (intent) => {
              void (async () => {
                try {
                  const saved = await completeChargebeeCardAction(
                    slug,
                    intent.id,
                  );
                  if (isDisposed()) return;
                  setMessage(saved.message);
                  if (saved.success) {
                    router.refresh();
                    close.current();
                  }
                } catch {
                  if (!isDisposed())
                    setMessage(
                      "Card could not be saved. Refresh before retrying.",
                    );
                } finally {
                  if (!isDisposed()) setPending(false);
                }
              })();
            },
          },
        );
        component.current = mounted;
        if (!container.current || !(await mounted.mount(container.current)))
          throw new Error("Form unavailable");
        if (!isDisposed()) setReady(true);
      } catch {
        if (!isDisposed())
          setMessage(
            "Secure card form could not be loaded. Please refresh to try again.",
          );
      }
    })();
    return () => {
      lifecycle.disposed = true;
      mounted?.close();
      component.current = null;
    };
  }, [slug, config.site, config.publishableKey, router]);
  return (
    <section className="mt-5 space-y-4 rounded-lg border bg-[#f7f6f2] p-5">
      <h3 className="font-semibold">Add a card</h3>
      <div className="relative min-h-32" aria-busy={!ready && !message}>
        {!ready && !message ? (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading secure card fields…
          </div>
        ) : null}
        <div ref={container} className="min-h-32" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
          }}
        />
        I authorise this card for future Mill subscription payments. Saving a
        card does not start a subscription.
      </label>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button
          disabled={!ready || !consent || pending}
          onClick={() => {
            void (async () => {
              if (!component.current || pending) return;
              setPending(true);
              setMessage("");
              try {
                if (!(await component.current.validate())) {
                  setPending(false);
                  return;
                }
                await component.current.confirm();
              } catch {
                setMessage("Card verification failed. Please try again.");
                setPending(false);
              }
            })();
          }}
        >
          {pending ? "Verifying card…" : "Save card"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
