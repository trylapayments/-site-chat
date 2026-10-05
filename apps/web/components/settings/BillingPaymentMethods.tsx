"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { CreditCard, LockKeyhole, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  startCardSetupAction,
  completeCardSetupAction,
  updateDefaultCardAction,
  removeCardAction,
} from "@/lib/billing/actions";
type Method = {
  id: string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number };
};
function CardForm({ slug, onClose }: { slug: string; onClose: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="mt-5 space-y-4 rounded-lg border bg-[#f7f6f2] p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          if (!stripe || !elements || pending) return;
          const card = elements.getElement(CardElement);
          if (!card) return;
          setPending(true);
          setMessage("");
          try {
            const setup = await startCardSetupAction(slug);
            if (!setup.success) {
              setMessage(setup.message);
              return;
            }
            const result = await stripe.confirmCardSetup(setup.clientSecret, {
              payment_method: { card, billing_details: { name, email } },
            });
            if (result.error) {
              setMessage(result.error.message ?? "Card could not be saved.");
              return;
            }
            if (result.setupIntent.status !== "succeeded") {
              setMessage("Please complete your bank's card verification.");
              return;
            }
            const saved = await completeCardSetupAction(
              slug,
              result.setupIntent.id,
            );
            setMessage(saved.message);
            if (saved.success) {
              router.refresh();
              onClose();
            }
          } catch {
            setMessage("Card could not be saved. Please try again.");
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Add a card</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          disabled={pending}
          aria-label="Close card form"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="card-name">Name on card</Label>
          <Input
            id="card-name"
            autoComplete="cc-name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="card-email">Billing email</Label>
          <Input
            id="card-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </div>
      </div>
      <div>
        <Label>Card details</Label>
        <div className="mt-2 rounded-md border bg-white px-3 py-4">
          <CardElement
            options={{
              hidePostalCode: false,
              style: {
                base: {
                  fontSize: "16px",
                  color: "#283134",
                  "::placeholder": { color: "#777b7d" },
                },
                invalid: { color: "#b42318" },
              },
            }}
            onReady={() => {
              setReady(true);
            }}
          />
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LockKeyhole className="size-3.5" />
        Card details are encrypted and processed by Stripe.
      </p>
      <p className="text-xs text-muted-foreground">
        By saving, you authorise this card for future Mill subscription
        payments. Saving a card does not start a subscription or charge you.
      </p>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={!stripe || !ready || pending}>
        {pending ? "Saving card…" : "Save card"}
      </Button>
    </form>
  );
}
function EmbeddedCardForm({
  slug,
  publishableKey,
  onClose,
}: {
  slug: string;
  publishableKey: string;
  onClose: () => void;
}) {
  const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripe}>
      <CardForm slug={slug} onClose={onClose} />
    </Elements>
  );
}
export function BillingPaymentMethods({
  slug,
  methods,
  defaultMethod,
  publishableKey,
  enabled,
  unavailable,
}: {
  slug: string;
  methods: Method[];
  defaultMethod: string | null;
  publishableKey: string | null;
  enabled: boolean;
  unavailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <section className="rounded-xl border border-inbox-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <CreditCard className="size-4 text-muted-foreground" />
          Payment methods
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled || !publishableKey || open}
          onClick={() => {
            setOpen(true);
          }}
        >
          <Plus className="mr-2 size-4" />
          Add card
        </Button>
      </div>
      {methods.length ? (
        <ul className="mt-5 divide-y">
          {methods.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="capitalize">
                  {m.card
                    ? `${m.card.brand} ending in ${m.card.last4}`
                    : "Card"}
                  {m.id === defaultMethod ? (
                    <span className="ml-2 rounded bg-[#edf1e9] px-2 py-1 text-xs text-[#52674c]">
                      Default
                    </span>
                  ) : null}
                </p>
                {m.card ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Expires {String(m.card.exp_month).padStart(2, "0")}/
                    {m.card.exp_year}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {m.id !== defaultMethod ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      startTransition(async () => {
                        const result = await updateDefaultCardAction(
                          slug,
                          m.id,
                        );
                        setMessage(result.message);
                        if (result.success) router.refresh();
                      });
                    }}
                  >
                    Make default
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm("Remove this saved card?")) return;
                    startTransition(async () => {
                      const result = await removeCardAction(slug, m.id);
                      setMessage(result.message);
                      if (result.success) router.refresh();
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {unavailable
            ? "Payment methods are temporarily unavailable."
            : "No saved payment method. Add a card securely here."}
        </p>
      )}
      {open && publishableKey ? (
        <EmbeddedCardForm
          slug={slug}
          publishableKey={publishableKey}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
