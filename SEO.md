# Getting found on Google — FastMoveX

What the code already does, and the work only people can do. Nobody can promise the first place on Google; what
decides it is a technically clean site (done), useful content, trust from other sites, and time (usually 2–3 months
before a new domain ranks for competitive words).

## What the website does by itself

| Area | What is in place |
|---|---|
| Pages Google can read | Server-rendered pages in English and Arabic (`/en/…`, `/ar/…`), `hreflang` between them, canonical addresses, filtered / paged / searched listings marked `noindex` so they never compete with the real page |
| Titles and descriptions | Every page: products ("Dallah Set — buy in Qatar \| FastMoveX"), categories ("Groceries — buy online in Qatar"), brands ("Dana Oud in Qatar — genuine products & prices"), stores, content pages. Own titles and descriptions can be written per category and brand (both languages) and per product (English) in the admin panel |
| Text on category and brand pages | Admin → Categories / Brands → **Google (SEO)**: an intro shown under the products, and questions & answers (shown as an accordion, sent to Google as FAQ data) |
| Brand pages | `/en/brand/<brand>` for every brand with products — for searches like "Samsung Qatar". Linked from product pages and from a search for the brand |
| Structured data | Organization / OnlineStore with logo, contact and social profiles; WebSite with the search box; Product with price, deal end date, stock, **delivery fee and time**, **return policy**, rating, brand and **GTIN** (real barcodes only); BreadcrumbList; ItemList on listings; FAQPage; Brand |
| Sitemaps | `/sitemap.xml` → pages, categories, brands, stores, and products with their **photos** (image sitemap), every page in both languages |
| Google Shopping | `/feeds/google-en.xml` and `/feeds/google-ar.xml` for Google Merchant Center (free listings): one item per variant, price, deal price with dates, stock, photos, brand, barcode, delivery fee and free-delivery threshold |
| Ownership | Search Console and Bing codes are entered in Admin → Settings → **Google & social** (paste the whole meta tag; the code is taken out of it) |
| Speed and mobile | Lighthouse mobile 88–98, responsive images (AVIF/WebP), installable app, strict security headers |

## The work only you can do (in this order)

1. **Domain and HTTPS live** (`fastmovex.qa`), `SITE_URL` set, demo data never loaded.
2. **Google Search Console**: add the domain property → copy the HTML-tag code into Settings → Google & social → Save
   → Verify. Submit `https://fastmovex.qa/sitemap.xml`. Do the same in **Bing Webmaster Tools** (it can import from
   Search Console).
3. **Google Business Profile** (free, the biggest help for "online shopping Qatar" and the map results): business
   name FastMoveX, category "Online retailer" / "E-commerce service", service area Qatar, website, phone, WhatsApp,
   opening hours, logo and photos. Verify it (postcard / video). Ask happy customers for Google reviews.
4. **Google Merchant Center**: create the account with the same Google login, verify the website, set the shipping
   (delivery fee, free over the threshold, 0–2 days in Qatar) and the return policy (same days as on the website),
   then Products → Feeds → add `https://fastmovex.qa/feeds/google-en.xml` (language English, country Qatar) and
   `…/google-ar.xml` (Arabic, Qatar), scheduled fetch daily. Turn on **free listings**. Fix any product warnings it
   shows (missing photo, barcode).
5. **Write the category and brand text** (Admin → Categories / Brands → Google (SEO)): start with the 10 categories
   that sell most. 2–4 short paragraphs in your own words for shoppers in Qatar, 3–5 real questions people ask
   (delivery time, cash on delivery, genuine products, returns). The "Missing" badge on Brands shows what is left.
6. **Products**: every product with good photos (white background first), a real description (not copied from
   another site), the **barcode** printed on the pack (Google trusts products with a GTIN more), the brand set.
7. **Social pages**: Instagram, TikTok, Snapchat… created and linked in Settings → Google & social (they appear with
   FastMoveX in Google). Put the website link in each profile.
8. **Links from other sites**: Qatar directories, local bloggers / Instagram reviewers, suppliers' "where to buy"
   pages, press for the launch. A few good Qatari links beat many weak ones. Never buy links.
9. **Check every month** in Search Console: Pages (anything not indexed and why), Performance (which searches bring
   visitors — write about those), Enhancements (Products, FAQ, Breadcrumbs errors), Merchant listings.

## What to expect

- Your own name ("FastMoveX", "fastmovex qatar") ranks first within days of Search Console verification.
- Brand + Qatar searches ("dana oud qatar") and long phrases ("khalas dates 1kg doha delivery") within weeks.
- Big generic words ("online shopping qatar", "buy iphone qatar") compete with Amazon-size shops: months of content,
  reviews and links. Google Shopping free listings are often the fastest way onto that first page.
