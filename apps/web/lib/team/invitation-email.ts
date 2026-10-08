import "server-only";
import { millEmailHtml } from "@/lib/email/mill-template";
export async function sendTeamInvitationEmail(input: {
  email: string; role: string; workspaceName: string; url: string; invitationId: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email provider unavailable");
  const subject = `You’re invited to ${input.workspaceName} on Mill`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `team-invite:${input.invitationId}` },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL ?? "Mill <notifications@notify.mill.chat>", to: [input.email], subject,
      text: `${subject}\n\nYou have been invited as ${input.role}.\nAccept invitation: ${input.url}`,
      html: millEmailHtml({ title: subject, paragraphs: [`You have been invited to join the team as ${input.role}.`, "Sign in or create your Mill account to accept the invitation."], button: { label: "Accept invitation", href: input.url } }),
    }),
  });
  if (!response.ok) throw new Error("Invitation email failed");
}
