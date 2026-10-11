# FastMoveX — free mein online test (Vercel + Render + Supabase)

Pura shop (website + admin panel + API + database + photos) internet par, **0 QAR** mein — FundX jaisa, bas FastMoveX
mein ek alag API server bhi hai, is liye 3 free services lagti hain:

| Kya | Kahan | Free plan |
|---|---|---|
| Website (`apps/web`) | **Vercel** | Hobby |
| Admin panel (`apps/admin`) | **Vercel** (doosra project) | Hobby |
| API (`apps/api`) | **Render** | Free web service |
| Database + photos | **Supabase** | Free project |

Total time: ~45–60 minute pehli dafa. Sirf ek GitHub account, aur in teeno par GitHub se sign up.

> **Yeh test ke liye hai, asli launch ke liye nahi.** Neeche "Limits" parhein.

---

## 0. Pehle ek kaagaz / Notes khol lein

Yeh values raste mein milti jayengi, sab ek jagah likhte jayein:

| Naam | Kahan se milega | Misaal |
|---|---|---|
| `REF` | Supabase project ka ref | `abcdxyzqwerty` |
| `DB_URL` | Supabase → Connect → Session pooler | `postgresql://postgres.abcd…:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` |
| `CA_CERT` | Supabase SSL certificate file | `-----BEGIN CERTIFICATE----- …` |
| `S3_REGION`, `S3_KEY`, `S3_SECRET` | Supabase → Storage → S3 | `eu-central-1` |
| `API` | Render service ka address | `https://fastmovex-api.onrender.com` |
| `SITE` | Vercel website ka address | `https://fastmovex-junaid.vercel.app` |
| `PANEL` | Vercel admin ka address | `https://fastmovex-junaid-admin.vercel.app` |
| `INTERNAL_KEY` | Render → Environment (khud banta hai) | 44 harf |

**Abhi se naam soch lein:** website project `fastmovex-<aapka-naam>` aur admin `fastmovex-<aapka-naam>-admin`. Vercel address
yahi banata hai (`https://<naam>.vercel.app`), is liye Render mein pehle se sahi likh sakte hain.

---

## 1. Code GitHub par

1. GitHub par **naya private repository** banayein, maslan `fastmovex`.
2. Zip ka `fastmovex` folder kholein — us ke andar `apps/`, `render.yaml`, `.gitignore` aur docs hain. Yahi repo ka root hai.
3. GitHub Desktop (asaan) ya terminal se push:
   ```bash
   cd fastmovex
   git init && git add . && git commit -m "FastMoveX"
   git branch -M main
   git remote add origin https://github.com/<aap>/fastmovex.git
   git push -u origin main
   ```
4. Check: GitHub par `.env` naam ki koi file **nahi** honi chahiye (sirf `.env.example`). `.gitignore` isay rokta hai.

---

## 2. Supabase — database aur photos

1. https://supabase.com → **Start your project** → GitHub se sign in → **New project**.
   - Name: `fastmovex-test`
   - **Database password:** lamba, sirf harf aur number (koi `@ # / ?` nahi — URL mein masla karte hain). Likh lein.
   - **Region: Central EU (Frankfurt)** (Render bhi Frankfurt mein hoga — dono paas, tez).
   - Agar "Security options" mein **Enable Data API** ka tick ho to **hata dein** (FastMoveX isay use nahi karta).
2. Project banne ke baad upar **Connect** → **Session pooler** wala URL copy (port **5432**). `[YOUR-PASSWORD]` ki jagah
   apna password likhein → yeh `DB_URL` hai. Address ka `postgres.` ke baad wala hissa `REF` hai.
3. **SSL certificate:** Project Settings → **Database** → **SSL Configuration** → **Download certificate**. File
   Notepad mein kholein, poora text (BEGIN se END tak) copy → `CA_CERT`. Is se API ka database connection
   encrypted aur verified hota hai.
4. **Photos ke buckets:** left menu **Storage** → **New bucket**:
   - `fastmovex-public` → **Public bucket ON**
   - `fastmovex-private` → Public **OFF**
5. **S3 keys:** Storage → **S3 Configuration** (ya Project Settings → Storage):
   - Endpoint dikhega: `https://REF.storage.supabase.co/storage/v1/s3` aur **Region** (maslan `eu-central-1`) → likh lein.
   - **New access key** → description `fastmovex-api` → **Access key ID** = `S3_KEY`, **Secret access key** = `S3_SECRET`
     (secret sirf ek dafa dikhta hai).
6. Data API band hai ya nahi, dobara check: Integrations / Project Settings → **Data API** → **Enable Data API: OFF**.
   (Har deploy par API khud bhi in tables se public API ki ijazat hata deta hai — `scripts/lock-data-api.ts`.)

---

## 3. Render — API

1. https://render.com → GitHub se sign up → **New +** → **Blueprint** → apna `fastmovex` repo chunein.
2. Render repo ki `render.yaml` parhta hai aur `fastmovex-api` (Free, Frankfurt) dikhata hai. Jo values woh poochay:

| Key | Value |
|---|---|
| `DATABASE_URL` | `DB_URL` |
| `DATABASE_CA_CERT` | `CA_CERT` (poora certificate text) |
| `S3_ENDPOINT` | `https://REF.storage.supabase.co/storage/v1/s3` |
| `S3_REGION` | `S3_REGION` (maslan `eu-central-1`) |
| `S3_ACCESS_KEY_ID` | `S3_KEY` |
| `S3_SECRET_ACCESS_KEY` | `S3_SECRET` |
| `PUBLIC_MEDIA_BASE_URL` | `https://REF.supabase.co/storage/v1/object/public/fastmovex-public` |
| `CORS_ORIGINS` | `SITE,PANEL` (comma, bina space) — maslan `https://fastmovex-junaid.vercel.app,https://fastmovex-junaid-admin.vercel.app` |
| `STOREFRONT_URL` | `SITE` |
| `ADMIN_URL` | `PANEL` |
| `SEED_SUPERADMIN_EMAIL` | aap ka email (super admin login) |
| `SEED_SUPERADMIN_PASSWORD` | mazboot password, 12+ harf |
| `DEMO_SEED_ALLOW` | `yes` (demo products + demo accounts chahiye) — warna `no` |
| `DEMO_PASSWORD` | apna **private** password 12+ harf (saare demo accounts ka) |

   Baaki (secrets, `NODE_ENV`, drivers) `render.yaml` khud bhar deta hai — `JWT_ACCESS_SECRET`,
   `FIELD_ENCRYPTION_KEY`, `INTERNAL_API_KEY` Render random bana deta hai.
3. **Apply** → pehla build ~5–8 minute (install → build → migrations → base data → demo data). Logs mein aakhir mein
   `FastMoveX API on :10000` aaye to theek.
4. Service ka address copy → `API` (maslan `https://fastmovex-api.onrender.com`). Browser mein kholein:
   `API/api/v1/health` → `{"status":"ok"…}` aana chahiye.
5. **Environment** tab → `INTERNAL_API_KEY` ki value copy → `INTERNAL_KEY`.
6. Demo data load ho gaya to `DEMO_SEED_ALLOW` ko **`no`** kar dein (Save) — warna har deploy par dobara chalega.

---

## 4. Vercel — website

1. https://vercel.com → GitHub se sign up → **Add New… → Project** → `fastmovex` repo **Import**.
2. **Project Name:** `fastmovex-<aapka-naam>` (wahi jo Render mein `SITE` likha).
3. **Root Directory → Edit → `apps/web`**. Framework: Next.js (khud aata hai).
4. **Environment Variables** (yeh poora block copy karke pehle box mein paste karein — Vercel khud alag kar deta hai;
   phir apni values badlein):
   ```
   PUBLIC_API_URL=https://fastmovex-junaid.vercel.app/api/v1
   API_PROXY_TARGET=https://fastmovex-api.onrender.com
   API_INTERNAL_URL=https://fastmovex-api.onrender.com/api/v1
   SITE_URL=https://fastmovex-junaid.vercel.app
   INTERNAL_API_KEY=<INTERNAL_KEY>
   NEXT_PUBLIC_MEDIA_URL=https://REF.supabase.co/storage/v1/object/public/fastmovex-public
   MEDIA_URL=https://REF.supabase.co
   DEFAULT_COUNTRY=QA
   IMAGE_OPTIMIZATION=false
   SOCIAL_SIGN_IN=off
   ```
   - `PUBLIC_API_URL` **website ka apna address** + `/api/v1` hai (Render ka nahi). Website `/api/v1` ko Render tak
     pohnchati hai (`API_PROXY_TARGET`), taa ke login cookie kaam kare.
5. **Deploy** (2–4 minute). Address `SITE` se alag nikla (naam pehle se liya hua tha)? To Vercel → Settings →
   Environment Variables mein `PUBLIC_API_URL` / `SITE_URL` theek karein → **Deployments → Redeploy**, aur Render mein
   `CORS_ORIGINS` / `STOREFRONT_URL` bhi.

## 5. Vercel — admin panel

1. Dobara **Add New… → Project** → wahi `fastmovex` repo → Name `fastmovex-<aapka-naam>-admin` → **Root Directory `apps/admin`**.
2. Environment Variables:
   ```
   PUBLIC_API_URL=https://fastmovex-junaid-admin.vercel.app/api/v1
   API_PROXY_TARGET=https://fastmovex-api.onrender.com
   STOREFRONT_URL=https://fastmovex-junaid.vercel.app
   MEDIA_URL=https://REF.supabase.co
   DEFAULT_COUNTRY=QA
   ```
3. **Deploy**. Address badla ho to upar wali tarah Render ke `CORS_ORIGINS` / `ADMIN_URL` theek karein (Render →
   Environment → **Save, rebuild, and deploy**).

---

## 6. API ko jaagta rakhein (zaroori)

Render free 15 minute khaali rehne par so jata hai; agla visitor ~1 minute wait karta hai. Aur Supabase free project
7 din bina kaam ke **pause** ho jata hai. Dono ka ilaaj ek free pinger:

1. https://uptimerobot.com (ya https://cron-job.org) → free account → **New monitor** → HTTP(s)
2. URL: `API/api/v1/health` (maslan `https://fastmovex-api.onrender.com/api/v1/health`), interval **5 minute**.

Yeh health check database bhi chhoota hai, is liye Supabase bhi active rehta hai. Ek service 24/7 ≈ 744 ghante —
Render ke 750 free ghante mein aa jata hai (doosri free service mat banayein, warna ghante kam parenge).

---

## 7. Pehla login aur settings

1. `PANEL` kholein → `SEED_SUPERADMIN_EMAIL` / password se login. Two-step sign-in yahan optional hai
   (`STAFF_TWO_FACTOR=optional`) — **Security** page par authenticator app se on kar sakte hain.
2. **Settings → Cash on delivery safety → "Confirm mobile by SMS code" → Off** → Save. (Free test mein SMS nahi hai; warna guest
   COD order nahi kar sakega.)
3. Card payment (Dibsy) test server par band hai → sirf **cash on delivery** chalega. Asli launch par Dibsy keys.
4. Email bhi band hai (`NOTIFY_EMAIL_DRIVER=none`): "forgot password" ka code nahi aayega — testers apna password
   yaad rakhein (bhool gaye to naya account bana lein).

**Demo accounts** (agar `DEMO_SEED_ALLOW=yes` tha) — sab ka password = aap ka `DEMO_PASSWORD`:
`customer@demo.jovia.test`, `admin@demo.jovia.test`, `ops@demo.jovia.test`, `finance@demo.jovia.test`,
`support@demo.jovia.test`, `courier@demo.jovia.test`, `seller.gadgets@demo.jovia.test` (aur `seller.oud`,
`seller.home`). Yeh password kisi ko na dein jis ko admin access nahi dena.

---

## 8. Kya kya test karein (checklist)

- [ ] `SITE` khule, English/Arabic dono, products ki photos nazar aayein
- [ ] Search: "oud", "power" likhein → photo + price ke saath suggestions
- [ ] Naya customer account banayein → page reload → ab bhi logged in (cookie theek)
- [ ] Cart → checkout → **Cash on delivery** → order number mile
- [ ] Admin: woh order nazar aaye → status badlein → customer ke "My orders" mein update
- [ ] Admin: naya product + photo upload (photo 4 MB se chhoti) → website par nazar aaye
- [ ] Courier: `courier@demo…` se phone par panel → delivery page
- [ ] Mobile par website "Add to Home screen"
- [ ] `SITE/robots.txt` → `Disallow: /` (test address Google mein nahi aana chahiye — sahi hai)

Code badla? Bas GitHub par push karein — Render aur Vercel khud dobara deploy karte hain (database ka data aur admin
settings waise hi rehte hain).

---

## Limits (imaandari se)

| | Kya hota hai |
|---|---|
| Render free | 15 min bina visit ke so jata hai → pehla page ~1 min (pinger se theek). 750 ghante/mahina, Hobby workspace par 5 GB bandwidth. Kabhi kabhi restart. |
| Supabase free | 500 MB database, 1 GB photos, 5 GB bandwidth; 7 din inactive → pause (pinger se theek); 2 free projects. |
| Vercel Hobby | Free lekin **non-commercial** — asli dukaan ke liye Pro ya apna server. |
| Rate limits | Sab visitors API ko Vercel ke server se aate dikhte hain → bohot zyada login koshishein ek saath karein to thori der "too many requests". Chand testers ke liye theek. |
| Payments / SMS / email | Band. Sirf COD. |
| Google | Test address par search engines ko roka hua hai (`robots.txt`). Asli domain (`fastmovex.qa`) par khud khul jata hai. |

**Asli launch par:** apna domain (`fastmovex.qa` + `api.fastmovex.qa`), paid plans ya ek VPS, `API_PROXY_TARGET` hata dein,
`DEMO_SEED_ALLOW=no` (demo data kabhi nahi), `STAFF_TWO_FACTOR=required`, Dibsy + SMS + email — dekhein
[DEPLOYMENT.md](DEPLOYMENT.md) "Go-live checklist". Test wala Supabase database asli ke liye istemal na karein
(demo accounts us mein hain) — naya project banayein.

## Kuch na chale to

| Masla | Wajah / hal |
|---|---|
| Render build: `Invalid environment variables` | Jo key log mein likhi hai woh khaali/galat — Render → Environment. |
| Render: `self-signed certificate` / `certificate` error | `DATABASE_CA_CERT` mein poora certificate nahi aaya (BEGIN/END lines samet), ya Supabase ka galat project. |
| Render: `password authentication failed` | `DB_URL` mein `[YOUR-PASSWORD]` ki jagah password nahi likha, ya password mein `@ # /` hain → Supabase mein password reset karein (sirf harf + number). |
| Website khulti hai, login ke baad reload par logout | `PUBLIC_API_URL` Vercel address + `/api/v1` nahi, ya `API_PROXY_TARGET` nahi — theek karke **Redeploy** (yeh build ke waqt parha jata hai). |
| Admin / website: "Network error", CORS | Render `CORS_ORIGINS` mein dono Vercel addresses bilkul sahi (https, aakhir mein `/` nahi). |
| Photos nahi dikhti | Bucket `fastmovex-public` **Public** hai? `PUBLIC_MEDIA_BASE_URL` / `NEXT_PUBLIC_MEDIA_URL` mein `REF` sahi? `NEXT_PUBLIC_MEDIA_URL` badla to Redeploy. |
| Pehla page bohot dair se | API so raha tha (~1 min). Pinger lagayein. |
