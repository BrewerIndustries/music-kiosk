export const metadata = { title: "Privacy — Music Kiosk" };

// Plain-language privacy policy (also the link Google's OAuth consent screen needs).
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-5 py-10 text-sm leading-relaxed">
      <h1 className="festive text-3xl">🎄 Music Kiosk — Privacy</h1>
      <p className="text-muted">Last updated 26 October 2026</p>
      <p>
        Music Kiosk is a private, invite-only party jukebox run by its owner for personal events. It is not a
        commercial service and is not offered to the public.
      </p>

      <h2 className="text-lg font-semibold">What it stores</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Kiosk accounts:</b> the email address and name of each invited operator, and a salted hash of their
          password. Sessions are kept in a secure cookie.
        </li>
        <li>
          <b>Guest song requests:</b> the name a guest types, the song they asked for, and a random ID kept on their
          phone so they can see their own requests. Requests are cleared after the event.
        </li>
        <li>
          <b>Spotify and YouTube connections:</b> the sign-in tokens for the one account that plays the music, so the
          kiosk can search, read that account&apos;s playlists and control playback.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Google / YouTube data</h2>
      <p>
        When an operator connects YouTube, Music Kiosk asks Google for <b>read-only</b> YouTube access plus the
        account&apos;s name and email. It uses that only to search YouTube for songs and to list that account&apos;s
        playlists and their songs so they can be played on the kiosk. It never uploads, edits, deletes or posts
        anything, and it does not sell, share or transfer Google user data to anyone. Music Kiosk&apos;s use of
        information received from Google APIs adheres to the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. YouTube songs play through YouTube&apos;s own embedded player,
        under the{" "}
        <a className="underline" href="https://www.youtube.com/t/terms">
          YouTube Terms of Service
        </a>{" "}
        and{" "}
        <a className="underline" href="https://policies.google.com/privacy">
          Google Privacy Policy
        </a>
        .
      </p>
      <p>
        Disconnecting YouTube in the kiosk&apos;s Settings deletes the stored Google tokens. You can also remove
        access at any time at{" "}
        <a className="underline" href="https://myaccount.google.com/permissions">
          myaccount.google.com/permissions
        </a>
        .
      </p>

      <h2 className="text-lg font-semibold">Where it lives</h2>
      <p>
        Data is stored on Cloudflare (Workers and Durable Objects). Invite and password-reset emails are sent through
        Cloudflare Email. Nothing is used for advertising or analytics.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      <p>
        Questions or deletion requests: contact the kiosk&apos;s owner (the person who invited you), or use the
        support email shown on Google&apos;s sign-in screen for this app.
      </p>
    </main>
  );
}
