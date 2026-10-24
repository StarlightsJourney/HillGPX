# hillGPX email templates

Branded bodies for the emails Supabase Auth sends. They replace the default
Supabase look (grey box, system font, "Follow this link") with the site's own
voice: Figtree/Nunito, an ink header band carrying the summit mark and
wordmark, a real topographic strip of Bukit Timah fading into the card body,
and the gradient accent button.

## Installing them

Supabase does not read these files — paste each one in the dashboard under
**Authentication → Emails → Templates**:

| File | Template slot | Suggested subject |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `Confirm your hillGPX account` |
| `recovery.html` | Reset password | `Reset your hillGPX password` |
| `email-change.html` | Change email address | `Confirm your new hillGPX email` |
| `magic-link.html` | Magic link | `Your hillGPX sign-in link` |

The app sends the first three (`signUp`/`resendConfirmation`, `resetPasswordForEmail`,
`updateUser({email})` in `src/lib/auth.ts`). The magic-link template is included so
enabling passwordless sign-in later never ships the default look.

Template variables used: `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`,
`{{ .Email }}`, and `{{ if .Data.username }}` for the greeting (the username
stored in `user_metadata` at sign-up). Keep the `{{ .ConfirmationURL }}` hrefs
verbatim — they carry the verify token.

## Making them trustworthy, not just pretty

The template is only half of "doesn't look scammy". Also check:

- **Sender name**: Authentication → Emails → SMTP Settings → set sender name to
  `hillGPX`.
- **Custom SMTP**: Supabase's shared mailer sends from
  `no-reply@mail.app.supabase.io` — a stranger's domain with rate limits. Point
  SMTP at a provider (Resend, SES, Postmark) sending from
  `noreply@hillgpx.com` with SPF/DKIM set on the domain; it lands in inboxes
  instead of spam folders.
- **Images**: the mark loads from `{{ .SiteURL }}/icons/icon-192.png` and the
  header strip from `{{ .SiteURL }}/email/topo-strip.png` (PNGs — email clients
  don't render SVG). Both ship with the site, so they render once the deploy is
  serving them on hillgpx.com.

## Editing

Layout is table-based with inline styles (what email clients need); the only
`<style>` block is the Google Fonts import, which unsupported clients ignore.
The button and header band keep `bgcolor`/`background-color` fallbacks because
Outlook drops gradients and rounded corners. The topo strip is baked by
`python3 scripts/render_email_assets.py` from the landing hero's Bukit Timah
tint and contour data into `public/email/topo-strip.png` — re-run it if the
hero assets or the strip's look change, and commit the output. Preview changes
by rendering the file with the `{{ ... }}` variables replaced — there is no
send-test button in the dashboard beyond going through a real sign-up or reset.
