# Security deployment checklist — Agenda Tech Beta

## Changes in this branch

- Restricts browser-origin access to https://agenda-tech-beta.vercel.app in the API and CORS response.
- Updates WhatsApp notification-link fallbacks to the Agenda Tech Beta production URL.
- Keeps verify_jwt = false because endpoints perform explicit application-key, owner-session/MFA, device-token, webhook-signature, and worker-secret checks. Do not remove those checks.

## Required dashboard actions

1. In Supabase Dashboard → Authentication → Settings/Security, enable leaked-password protection.
2. In Supabase Edge Functions secrets, set PUBLIC_SITE_URL=https://agenda-tech-beta.vercel.app/.
3. Confirm SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY and the WhatsApp worker secret are server-side secrets only. Never place them in VITE_* variables or commit them.
4. Deploy updated Edge Functions after merging this branch: barber-api and whatsapp-worker. Redeploy any function importing the changed shared modules.
5. Confirm Vercel production deploys the updated base branch.

## Safe verification

Use two owner-created test customers and fictitious bookings:
- Customer A sees only A's bookings; Customer B sees only B's.
- A cannot read, cancel, or reschedule B's booking.
- Unauthenticated requests cannot call owner-only actions.
- A signed-in non-admin is denied owner-only actions.
- Invalid webhook signatures are rejected.
- Worker requests without the internal worker key are rejected.
- Unapproved browser origins are rejected and the production origin works.
- Notification links point to agenda-tech-beta.vercel.app.

CORS is not a substitute for server-side authorization. Device tokens are bearer credentials: never log them, put them in URLs, or share them. Keep per-booking ownership checks and rate limits in the database RPC.

Leaked-password protection is a Supabase dashboard setting and must be enabled separately by a project owner.
