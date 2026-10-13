# FastMoveX — logo and colours

Name: **FastMoveX** (Arabic: **فاست موف إكس**). Logo wordmark: **FMX**. Domain: `fastmovex.qa`. Order numbers: `FMX-QA-…`.

| File | Use |
|---|---|
| `fastmovex-logo-light.svg` | Logo on white / light backgrounds (dark letters) — website header, admin panel, documents |
| `fastmovex-logo-dark.svg` | Logo on black / dark backgrounds (white letters) — social posts, videos, dark banners |
| `fastmovex-logo-dark-text-2130.png`, `fastmovex-logo-white-text-2130.png` | Same as PNG (transparent background) for apps that cannot open SVG (WhatsApp, Canva, print shops) |
| `fastmovex-mark.svg`, `fastmovex-app-icon-512.png` | Square icon: purple X on a dark tile — favicon, app icon, Home-Screen icon |
| `fastmovex-mark-maskable.svg` | Same icon with extra space around it (Android adaptive icons) |
| `fastmovex-profile-1080.png` | Profile picture: Instagram, TikTok, Snapchat, WhatsApp Business, Google Business Profile |
| `social/` | Social media kit: profile picture, Facebook cover, Instagram highlight covers, and the names / bios to paste (`social/SOCIAL.md`) |
| `fastmovex-share-1200x630.png` | Picture shown when a link to the website is shared (WhatsApp, Facebook, X) |

Colours

| | Hex | Where |
|---|---|---|
| Purple (light end of the X) | `#C13CFE` | logo gradient top |
| Violet (dark end of the X) | `#6711FA` | logo gradient bottom |
| Brand purple | `#7422E6` | buttons, links, browser bar (white text on it passes WCAG AA) |
| Night | `#0B0713` | icon tile, dark backgrounds |
| Ink | `#14101F` | logo letters on light backgrounds |

Rules: do not stretch, recolour or add effects to the logo; keep empty space around it at least the height of the
speed lines; on photos use the dark or light version, whichever reads better. The logo is never mirrored for Arabic.

The SVGs were traced from the original artwork (`fmx-logo.png`), so curves follow the original drawing. For print at
large sizes (shop sign, van), ask a designer to redraw it from these files in Illustrator.

The old working name "JOVIA" is gone from the code, the settings and the database (migration
`20261014010000_fastmovex_names` renamed its codes, functions, triggers and demo accounts). It only remains in the old
migration files themselves, which are history and are never edited.
