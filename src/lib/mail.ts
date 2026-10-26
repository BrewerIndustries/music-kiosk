// Account emails (invites, password resets) through Cloudflare Email Sending — the
// Worker's `send_email` binding, attached by the Durable Object. Fails soft: if
// the binding isn't configured yet or the send fails, the link is logged and the
// caller hands it to an admin to pass on by hand.
import { logError } from "./log";

type Mailer = {
  send(msg: { to: string; from: { email: string; name: string }; subject: string; text: string; html: string }): Promise<unknown>;
};

let mailer: Mailer | null = null;
export function attachMailer(m: Mailer | undefined) {
  mailer = m ?? null;
}

const FROM = { email: "noreply@dabrewer.dev", name: "Music Kiosk" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Returns true if the email went out.
export async function sendLinkEmail(to: string, kind: "invite" | "reset", link: string, inviter?: string) {
  const subject = kind === "invite" ? "You're invited to the Music Kiosk 🎄" : "Reset your Music Kiosk password";
  const lead =
    kind === "invite"
      ? `${inviter ? `${inviter} has invited you` : "You've been invited"} to run the Music Kiosk. Pick a password to get started — this link works for 7 days.`
      : "Someone (hopefully you) asked to reset your Music Kiosk password. This link works for 1 hour. If it wasn't you, ignore this email.";
  const button = kind === "invite" ? "Set my password" : "Reset password";
  const text = `${lead}\n\n${link}\n`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;padding:24px;color:#13261d">
<h2 style="color:#c8203a;margin:0 0 12px">🎄 Music Kiosk</h2>
<p style="line-height:1.5">${esc(lead)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#c8203a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${button}</a></p>
<p style="font-size:12px;color:#5b6b63;word-break:break-all">${esc(link)}</p></div>`;
  if (!mailer) {
    console.log(`[mail] no EMAIL binding — ${kind} link for ${to}: ${link}`);
    return false;
  }
  try {
    await mailer.send({ to, from: FROM, subject, text, html });
    return true;
  } catch (e) {
    logError("mail", e, `${kind} email to ${to}`);
    console.log(`[mail] send failed — ${kind} link for ${to}: ${link}`);
    return false;
  }
}
