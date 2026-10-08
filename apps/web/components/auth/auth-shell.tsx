import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check, MessageSquare, Sparkles } from "lucide-react";
import styles from "./auth-shell.module.css";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className={styles.shell}>
      <section className={styles.formColumn}>
        <a
          href="https://mill.chat"
          className={styles.logoLink}
          aria-label="Mill website"
        >
          <Image
            src="/brand/mill-logo.png"
            width={112}
            height={40}
            alt="Mill"
            priority
          />
        </a>
        <div className={styles.formWrap}>
          <span className={styles.eyebrow}>YOUR MILL WORKSPACE</span>
          <h1>{title}</h1>
          {description ? (
            <p className={styles.description}>{description}</p>
          ) : null}
          <div className={styles.formContent}>{children}</div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
        <div className={styles.bottom}>
          <span>© {new Date().getFullYear()} Mill Standard, Inc.</span>
          <a href="https://mill.chat">
            Back to Mill <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
      <aside
        className={styles.storyColumn}
        aria-label="Meet your Mill workspace"
      >
        <div className={styles.storyCopy}>
          <span className={styles.storyEyebrow}>
            A BETTER CONVERSATION STARTS HERE
          </span>
          <h2>
            Good to see you.
            <br />
            Great to stay connected.
          </h2>
          <p>
            Your people, your conversations and your customer care. All together
            in Mill.
          </p>
        </div>
        <div className={styles.storyMedia}>
          <Image
            src="/brand/mill-auth-team.png"
            alt="Customer care teammates working together"
            fill
            sizes="(max-width: 900px) 100vw, 50vw"
            className={styles.photo}
          />
          <div className={styles.chatCard} aria-hidden="true">
            <div className={styles.chatHeader}>
              <span className={styles.chatMark}>
                <MessageSquare size={19} />
              </span>
              <div>
                <strong>Mill</strong>
                <small>
                  <i />
                  Your team is here
                </small>
              </div>
              <span className={styles.chatMenu}>···</span>
            </div>
            <div className={styles.incoming}>
              Hi! Can you help me with my order?
            </div>
            <div className={styles.outgoing}>
              Of course. Let’s take a look together.
            </div>
            <div className={styles.chatStatus}>
              <Check size={12} /> A little help. A better experience.
            </div>
          </div>
          <div className={styles.aiNote}>
            <Sparkles size={15} />
            <span>Mill AI · A helpful answer, ready for your team.</span>
          </div>
        </div>
        <div className={styles.storyFooter}>
          <span>
            <Check size={14} /> One shared inbox
          </span>
          <span>
            <Check size={14} /> Your own branding
          </span>
          <span>
            <Check size={14} /> A connected team
          </span>
        </div>
      </aside>
    </main>
  );
}
export function AuthLink({
  href,
  children,
}: {
  href: Route;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-primary font-medium hover:underline">
      {children}
    </Link>
  );
}
export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-destructive text-sm">{message}</p> : null;
}
export function FormMessage({ message }: { message?: string }) {
  return message ? (
    <p className="bg-muted rounded-md px-3 py-2 text-sm" role="status">
      {message}
    </p>
  ) : null;
}
