#!/usr/bin/env bash
# M Andamul Development OS — put the STAGING system online (synthetic data only).
# Run on your Mac, in Terminal, from the unzipped mandamul-platform folder:
#     bash scripts/go-live-staging.sh
# It will ask you to: sign in to Supabase (browser), type the staging database password, choose a password for the
# synthetic test users, and sign in to Vercel (browser). Nothing secret is written to disk by this script.
set -euo pipefail
cd "$(dirname "$0")/.."
REF=cczakfyggevocethwayi                        # Supabase project: mandamul-staging (Mumbai)
SUPABASE_URL="https://$REF.supabase.co"
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjemFrZnlnZ2V2b2NldGh3YXlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNzM4NTUsImV4cCI6MjExMDY0OTg1NX0.yya59wIG-1ZINNAHw5EeCQkR4eQ3UFUybsGUbdLFgWQ   # public (publishable) key
TEAM=parakkat-jewels; VPROJECT=mandamul-os      # Vercel team and project (created 19 Nov 2026)
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
command -v node >/dev/null || { echo "Node.js is needed: https://nodejs.org (LTS)"; exit 1; }
BUN=$(command -v bun || echo "$HOME/.bun/bin/bun"); [ -x "$BUN" ] || { echo "Bun is needed: curl -fsSL https://bun.sh/install | bash"; exit 1; }
SB="npx -y supabase@latest"; VC="npx -y vercel@latest"

step "1/6  Supabase sign-in"
$SB projects list >/dev/null 2>&1 || $SB login

step "2/6  Link the staging project (type the database password you set in the Supabase dashboard)"
$SB link --project-ref "$REF"

step "3/6  Load the database: 20 migrations"
$SB db push

step "4/6  API and sign-in settings: expose the api schema, sign-ups off, authenticator (TOTP) MFA on"
if ! $SB config push --project-ref "$REF"; then
  echo "  Could not push the settings automatically. In the Supabase dashboard set: Data API → Exposed schemas: api, public;"
  echo "  Authentication → Sign In / Providers → Allow new users to sign up: off; Authentication → Multi-Factor → TOTP: enabled."
fi

step "5/6  Synthetic staging users (example.com addresses; nobody receives email)"
SERVICE=$($SB projects api-keys --project-ref "$REF" -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(x=>x.name==="service_role"||x.id==="service_role");process.stdout.write(k?k.api_key:"")})')
[ -n "$SERVICE" ] || { echo "Could not read the service key; create the users in Authentication → Users instead."; exit 1; }
read -r -s -p "Choose one password for all staging test users (min 10 characters): " PW; echo
for u in md pd pm site proc qs finance contractor; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
    -H 'content-type: application/json' -d "{\"email\":\"staging-$u@example.com\",\"password\":\"$PW\",\"email_confirm\":true}")
  echo "  staging-$u@example.com → $code (422 means it already exists)"
done
unset SERVICE PW

step "6/6  Build the app and publish it on Vercel ($TEAM / $VPROJECT)"
(cd app && "$BUN" install && SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$ANON_KEY" APP_ENV=staging "$BUN" run build.ts && cp static-vercel.json dist/vercel.json)
(cd app/dist && $VC link --yes --project "$VPROJECT" --scope "$TEAM" && $VC deploy --prod --yes)

echo
echo "Done. Tell Claude in the chat — it will finish the setup (roles, a synthetic demo project) and test the live sign-in."
