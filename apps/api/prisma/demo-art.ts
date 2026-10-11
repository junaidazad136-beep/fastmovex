/**
 * Demo product pictures: simple flat illustrations (no brands, no logos), drawn as SVG and turned into PNG by sharp
 * when the demo shop is loaded. They make a fresh demo look like a real shop; the team replaces them with real photos.
 */

const W = 600;

const svg = (body: string, defs = '', bg = '#FFFFFF') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">` +
  `<defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>${defs}</defs>` +
  (bg === 'none' ? '' : `<rect width="${W}" height="${W}" fill="${bg}"/>`) + body + '</svg>';

const shadow = (cx: number, cy: number, rx: number, ry = 18, o = 0.16) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#1b1033" opacity="${o}" filter="url(#blur)"/>`;
const lin = (id: string, stops: [number, string][], x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

// ---------------------------------------------------------------- pieces reused by several pictures

const earbudsCase = (x: number, y: number, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-110" y="-80" width="220" height="170" rx="70" fill="url(#case)" stroke="#E2E4EA" stroke-width="3"/>
  <path d="M-108 -12 H108" stroke="#D5D8E0" stroke-width="3"/>
  <circle cx="0" cy="34" r="5" fill="#9AE6B4"/>
</g>`;
const earbud = (x: number, y: number, flip = 1) => `<g transform="translate(${x} ${y}) scale(${flip} 1)">
  <ellipse cx="0" cy="0" rx="34" ry="30" fill="url(#case)" stroke="#E2E4EA" stroke-width="3"/>
  <rect x="10" y="10" width="20" height="96" rx="10" fill="url(#case)" stroke="#E2E4EA" stroke-width="3" transform="rotate(-12)"/>
  <ellipse cx="-12" cy="-4" rx="12" ry="9" fill="#2B2F3A" opacity="0.85"/>
</g>`;
const caseDefs = lin('case', [[0, '#FFFFFF'], [1, '#E9EBF0']]);

const phone = (x: number, y: number, s = 1, screen = 'url(#scr)') => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-95" y="-190" width="190" height="380" rx="34" fill="#1F2230"/>
  <rect x="-86" y="-181" width="172" height="362" rx="27" fill="${screen}"/>
  <rect x="-30" y="-176" width="60" height="16" rx="8" fill="#0B0D14"/>
</g>`;
const screenDefs = lin('scr', [[0, '#C13CFE'], [0.55, '#7422E6'], [1, '#1E0B45']], 0.6, 1);

const watch = (x: number, y: number, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-58" y="-190" width="116" height="120" rx="26" fill="#2A2D38"/>
  <rect x="-58" y="70" width="116" height="120" rx="26" fill="#2A2D38"/>
  <rect x="-95" y="-110" width="190" height="220" rx="52" fill="#3A3E4C"/>
  <rect x="-82" y="-97" width="164" height="194" rx="42" fill="#0B0D14"/>
  <circle cx="0" cy="0" r="64" fill="none" stroke="url(#scr)" stroke-width="12" stroke-dasharray="300 200" stroke-linecap="round"/>
  <path d="M0 0 L0 -40 M0 0 L30 16" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/><circle cx="0" cy="0" r="8" fill="#C13CFE"/>
  <rect x="94" y="-30" width="10" height="44" rx="5" fill="#5A5F70"/>
</g>`;

const laptop = (x: number, y: number, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-210" y="-160" width="420" height="270" rx="16" fill="#2B2E39"/>
  <rect x="-196" y="-146" width="392" height="242" rx="8" fill="url(#lap)"/>
  <path d="M-250 112 H250 L232 132 H-232 Z" fill="url(#alu)"/>
  <rect x="-40" y="112" width="80" height="8" rx="4" fill="#AEB3BF"/>
</g>`;
const laptopDefs = lin('lap', [[0, '#1E0B45'], [0.5, '#5F19C0'], [1, '#C13CFE']], 1, 1) + lin('alu', [[0, '#E6E8ED'], [1, '#B7BCC7']]);

const bottle = (x: number, y: number, body: string, cap: string, h = 230, w = 170) => `<g transform="translate(${x} ${y})">
  <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="28" fill="${body}"/>
  <rect x="${-w / 2 + 14}" y="${-h / 2 + 16}" width="22" height="${h - 50}" rx="11" fill="#FFFFFF" opacity="0.22"/>
  <rect x="-26" y="${-h / 2 - 34}" width="52" height="38" rx="6" fill="#C9A24A"/>
  <rect x="-44" y="${-h / 2 - 110}" width="88" height="80" rx="18" fill="${cap}"/>
  <rect x="${-w / 2 + 30}" y="${-10}" width="${w - 60}" height="56" rx="8" fill="#FFFFFF" opacity="0.88"/>
  <rect x="${-w / 2 + 50}" y="${6}" width="${w - 100}" height="8" rx="4" fill="#C9A24A"/>
  <rect x="${-w / 2 + 64}" y="${24}" width="${w - 128}" height="6" rx="3" fill="#B9B2A5"/>
</g>`;

// ---------------------------------------------------------------- the pictures

export const DEMO_ART: Record<string, () => string> = {
  'nova-x12-wireless-earbuds': () => svg(shadow(300, 470, 190) + earbudsCase(300, 360, 1.25) + earbud(215, 165) + earbud(395, 170, -1), caseDefs),

  'nova-powercore-20000-power-bank': () => svg(shadow(300, 500, 150) + `<g transform="rotate(-8 300 300)">
    <rect x="190" y="110" width="220" height="380" rx="40" fill="url(#pb)"/>
    <rect x="206" y="126" width="24" height="320" rx="12" fill="#FFFFFF" opacity="0.08"/>
    ${[0, 1, 2, 3].map((i) => `<circle cx="${262 + i * 26}" cy="440" r="7" fill="${i < 3 ? '#8F3CF7' : '#4A4E5C'}"/>`).join('')}
    <rect x="270" y="100" width="60" height="14" rx="7" fill="#11131A"/>
  </g>`, lin('pb', [[0, '#3C4050'], [1, '#1D1F29']])),

  'nova-65w-gan-usb-c-charger': () => svg(shadow(300, 480, 160) + `
    <path d="M300 420 C 300 520, 470 500, 500 560" stroke="#E4E6EC" stroke-width="18" fill="none" stroke-linecap="round"/>
    <rect x="200" y="200" width="200" height="220" rx="36" fill="url(#case)" stroke="#E2E4EA" stroke-width="3"/>
    <rect x="245" y="120" width="22" height="90" rx="6" fill="#C5C9D3"/><rect x="333" y="120" width="22" height="90" rx="6" fill="#C5C9D3"/>
    <rect x="265" y="370" width="70" height="20" rx="10" fill="#2B2F3A"/>
    <path d="M308 262 L276 318 H302 L292 356 L326 298 H300 Z" fill="#7422E6"/>`, caseDefs),

  'falcon-pro-wireless-controller': () => svg(shadow(300, 470, 210) + `
    <path d="M150 230 C 190 170, 410 170, 450 230 C 500 300, 540 430, 470 450 C 420 465, 400 390, 360 380 H240 C 200 390, 180 465, 130 450 C 60 430, 100 300, 150 230 Z" fill="url(#pad)"/>
    <circle cx="215" cy="300" r="34" fill="#1A1C24"/><circle cx="215" cy="300" r="22" fill="#2E3240"/>
    <circle cx="350" cy="350" r="30" fill="#1A1C24"/><circle cx="350" cy="350" r="19" fill="#2E3240"/>
    <rect x="232" y="338" width="16" height="48" rx="4" fill="#1A1C24"/><rect x="216" y="354" width="48" height="16" rx="4" fill="#1A1C24"/>
    ${[[395, 265, '#C13CFE'], [430, 295, '#8F3CF7'], [360, 295, '#A865FC'], [395, 325, '#7422E6']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="15" fill="${c}"/>`).join('')}
    <rect x="280" y="250" width="40" height="10" rx="5" fill="#8F3CF7" opacity="0.9"/>`, lin('pad', [[0, '#F4F2F8'], [1, '#D9D6E2']])),

  'falcon-tkl-mechanical-keyboard': () => svg(shadow(300, 440, 250) + `<g transform="translate(300 320) rotate(-6)">
    <rect x="-250" y="-110" width="500" height="220" rx="22" fill="#23252F"/>
    ${Array.from({ length: 5 }, (_, r) => Array.from({ length: 13 }, (_, c) => `<rect x="${-232 + c * 36}" y="${-92 + r * 36}" width="30" height="30" rx="6" fill="${(r + c) % 7 === 0 ? '#8F3CF7' : '#3A3D4A'}"/>`).join('')).join('')}
    <rect x="-160" y="88" width="300" height="0" rx="0"/>
  </g>`),

  'aluminium-adjustable-laptop-stand': () => svg(shadow(300, 500, 230) + `
    <path d="M150 470 L300 300 L450 470" stroke="url(#alu)" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="translate(300 260) rotate(-18)"><rect x="-200" y="-12" width="400" height="24" rx="8" fill="url(#alu)"/></g>
    <g transform="translate(300 250) rotate(-18) scale(0.62)"><rect x="-210" y="-250" width="420" height="250" rx="16" fill="#2B2E39"/><rect x="-196" y="-236" width="392" height="222" rx="8" fill="url(#lap)"/></g>`, laptopDefs),

  'nova-clear-shockproof-case-6-1': () => svg(shadow(300, 520, 140) + `<g transform="rotate(-10 300 300)">
    <rect x="195" y="90" width="210" height="420" rx="40" fill="#EAF2FF" opacity="0.55" stroke="#C7D7F0" stroke-width="6"/>
    <rect x="215" y="110" width="88" height="96" rx="24" fill="#FFFFFF" opacity="0.7" stroke="#C7D7F0" stroke-width="4"/>
    <circle cx="240" cy="136" r="14" fill="#C7D7F0"/><circle cx="278" cy="136" r="14" fill="#C7D7F0"/><circle cx="240" cy="178" r="14" fill="#C7D7F0"/>
  </g>`),

  'nova-smart-watch-s3': () => svg(shadow(300, 500, 120) + watch(300, 300, 1.15), screenDefs),

  'dana-royal-oud-eau-de-parfum': () => svg(shadow(300, 520, 140) + bottle(300, 380, 'url(#oud)', '#2A1A0F', 250, 190), lin('oud', [[0, '#7A3E12'], [1, '#2E1505']])),

  'dana-musk-al-tahara': () => svg(shadow(300, 500, 110) + bottle(300, 390, 'url(#musk)', '#C9A24A', 190, 150), lin('musk', [[0, '#FFFFFF'], [1, '#E8E2F2']])),

  'cambodian-oud-bakhoor-50g': () => svg(shadow(300, 480, 200) + `
    <rect x="130" y="250" width="340" height="200" rx="22" fill="url(#wood)"/>
    <rect x="150" y="270" width="300" height="160" rx="16" fill="#3B2210"/>
    ${Array.from({ length: 18 }, (_, i) => `<rect x="${170 + (i % 6) * 45}" y="${290 + Math.floor(i / 6) * 45}" width="34" height="18" rx="6" transform="rotate(${(i * 37) % 60 - 30} ${187 + (i % 6) * 45} ${299 + Math.floor(i / 6) * 45})" fill="${i % 3 ? '#6B3A17' : '#8A4E22'}"/>`).join('')}
    <path d="M130 250 L300 170 L470 250" fill="#C9A24A" opacity="0.9"/>`, lin('wood', [[0, '#A8672E'], [1, '#6B3A17']])),

  'electric-bakhoor-burner': () => svg(shadow(300, 510, 150) + `
    <path d="M190 500 H410 L380 400 H220 Z" fill="url(#gold)"/>
    <rect x="200" y="300" width="200" height="110" rx="14" fill="url(#gold)"/>
    <path d="M200 300 Q300 230 400 300 Z" fill="#E7C978"/>
    <path d="M300 230 C 270 190, 330 170, 300 120 C 340 150, 330 200, 300 230" fill="#C9C3D6" opacity="0.6"/>
    <circle cx="300" cy="360" r="20" fill="#7422E6"/>`, lin('gold', [[0, '#F0D28A'], [1, '#B98D2E']])),

  'rose-amber-body-mist': () => svg(shadow(300, 520, 100) + `
    <rect x="235" y="200" width="130" height="300" rx="30" fill="url(#mist)"/>
    <rect x="252" y="215" width="18" height="250" rx="9" fill="#FFFFFF" opacity="0.3"/>
    <rect x="265" y="150" width="70" height="56" rx="10" fill="#F2F2F5"/><rect x="255" y="120" width="90" height="36" rx="12" fill="#E3B5C3"/>
    <rect x="252" y="330" width="96" height="60" rx="8" fill="#FFFFFF" opacity="0.85"/><circle cx="300" cy="360" r="14" fill="#D9718E"/>`, lin('mist', [[0, '#F7C6D3'], [1, '#D9718E']])),

  'luxury-oud-gift-set': () => svg(shadow(300, 500, 230) + `
    <rect x="110" y="250" width="380" height="230" rx="18" fill="#2A1640"/>
    <rect x="110" y="250" width="380" height="60" rx="18" fill="#3A1D5C"/>
    <rect x="280" y="250" width="40" height="230" fill="#C9A24A"/>
    <path d="M300 250 C 240 180, 190 220, 260 250 Z M300 250 C 360 180, 410 220, 340 250 Z" fill="#E7C978"/>
    ${bottle(190, 220, 'url(#oud)', '#2A1A0F', 120, 90).replace('<g transform="translate(190 220)">', '<g transform="translate(190 210) scale(0.7)">')}`, lin('oud', [[0, '#7A3E12'], [1, '#2E1505']])),

  'argan-hair-oil': () => svg(shadow(300, 520, 100) + `
    <rect x="230" y="230" width="140" height="270" rx="30" fill="url(#amber)"/>
    <rect x="248" y="245" width="18" height="220" rx="9" fill="#FFFFFF" opacity="0.25"/>
    <rect x="262" y="170" width="76" height="66" rx="10" fill="#1E1E24"/><rect x="282" y="110" width="36" height="64" rx="18" fill="#1E1E24"/>
    <rect x="250" y="330" width="100" height="70" rx="8" fill="#FFF8EA"/><rect x="266" y="350" width="68" height="8" rx="4" fill="#B57A1E"/><rect x="276" y="370" width="48" height="6" rx="3" fill="#C9B79A"/>`, lin('amber', [[0, '#E3A33A'], [1, '#9C5A10']])),

  'saffron-face-serum': () => svg(shadow(300, 520, 90) + `
    <rect x="240" y="250" width="120" height="250" rx="22" fill="url(#saf)"/>
    <rect x="256" y="265" width="16" height="200" rx="8" fill="#FFFFFF" opacity="0.3"/>
    <rect x="266" y="190" width="68" height="66" rx="10" fill="#F5F0E8"/><rect x="284" y="120" width="32" height="74" rx="16" fill="#F5F0E8"/>
    <rect x="256" y="340" width="88" height="70" rx="8" fill="#FFFFFF" opacity="0.9"/><circle cx="300" cy="375" r="16" fill="#E8590C"/>`, lin('saf', [[0, '#FFB25E'], [1, '#D9480F']])),

  'arabic-coffee-dallah-set': () => svg(shadow(300, 510, 230) + `
    <path d="M230 470 H370 L355 330 C 355 290, 245 290, 245 330 Z" fill="url(#gold)"/>
    <path d="M250 300 C 250 250, 350 250, 350 300 Z" fill="#E7C978"/>
    <path d="M300 250 L300 215" stroke="#B98D2E" stroke-width="12" stroke-linecap="round"/>
    <path d="M245 330 C 190 320, 160 280, 130 250" stroke="url(#gold)" stroke-width="18" fill="none" stroke-linecap="round"/>
    <path d="M355 340 C 420 340, 420 430, 362 440" stroke="#B98D2E" stroke-width="12" fill="none"/>
    <path d="M420 470 H480 L470 420 H430 Z" fill="#FFFFFF" stroke="#C9A24A" stroke-width="5"/>
    <path d="M120 470 H180 L170 420 H130 Z" fill="#FFFFFF" stroke="#C9A24A" stroke-width="5"/>`, lin('gold', [[0, '#F0D28A'], [1, '#B98D2E']])),

  'premium-khalas-dates-1kg': () => svg(shadow(300, 490, 230) + `
    <rect x="100" y="250" width="400" height="220" rx="24" fill="#F6EEDF" stroke="#E2D2B4" stroke-width="4"/>
    ${Array.from({ length: 15 }, (_, i) => `<ellipse cx="${150 + (i % 5) * 75}" cy="${300 + Math.floor(i / 5) * 60}" rx="32" ry="22" fill="url(#date)" transform="rotate(${(i * 23) % 40 - 20} ${150 + (i % 5) * 75} ${300 + Math.floor(i / 5) * 60})"/>`).join('')}
    <path d="M100 250 L140 200 H460 L500 250" fill="#7A4A1E"/>`, lin('date', [[0, '#A0622A'], [1, '#5C3311']])),

  'sidr-honey-500g': () => svg(shadow(300, 510, 150) + `
    <rect x="190" y="240" width="220" height="260" rx="40" fill="url(#honey)"/>
    <rect x="210" y="260" width="24" height="200" rx="12" fill="#FFFFFF" opacity="0.25"/>
    <rect x="200" y="190" width="200" height="60" rx="14" fill="#5B3A1A"/>
    <rect x="220" y="320" width="160" height="90" rx="10" fill="#FFF8E6"/><rect x="245" y="345" width="110" height="10" rx="5" fill="#B5761A"/><rect x="260" y="370" width="80" height="8" rx="4" fill="#CDB892"/>`, lin('honey', [[0, '#F6B73C'], [1, '#B86E0E']])),

  'memory-foam-prayer-mat': () => svg(shadow(300, 500, 230) + `<g transform="rotate(-8 300 330)">
    <rect x="110" y="200" width="380" height="270" rx="16" fill="#0F5E4C"/>
    <rect x="130" y="220" width="340" height="230" rx="10" fill="none" stroke="#C9A24A" stroke-width="6"/>
    <path d="M300 240 C 250 240, 220 290, 220 330 V430 H380 V330 C 380 290, 350 240, 300 240 Z" fill="#137A62" stroke="#C9A24A" stroke-width="5"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${118 + i * 52}" y="470" width="8" height="26" fill="#C9A24A"/>`).join('')}
  </g>`),

  'non-stick-cookware-set-10pc': () => svg(shadow(300, 500, 240) + `
    <rect x="130" y="270" width="250" height="190" rx="26" fill="url(#pot)"/>
    <path d="M120 270 H390" stroke="#1B1D24" stroke-width="16" stroke-linecap="round"/>
    <path d="M150 262 Q255 190 360 262 Z" fill="#9FA4B1" opacity="0.7"/><circle cx="255" cy="215" r="14" fill="#1B1D24"/>
    <rect x="85" y="320" width="50" height="22" rx="10" fill="#1B1D24"/><rect x="375" y="320" width="50" height="22" rx="10" fill="#1B1D24"/>
    <ellipse cx="420" cy="440" rx="110" ry="34" fill="#2A2D38"/><rect x="510" y="425" width="80" height="18" rx="9" fill="#1B1D24"/>`, lin('pot', [[0, '#3D4150'], [1, '#1E2029']])),

  'velvet-majlis-floor-cushion': () => svg(shadow(300, 470, 230) + `
    <path d="M110 250 C 110 200, 490 200, 490 250 V420 C 490 470, 110 470, 110 420 Z" fill="url(#vel)"/>
    <path d="M130 230 Q300 260 470 230" stroke="#FFFFFF" stroke-width="6" opacity="0.35" fill="none"/>
    <path d="M130 445 Q300 415 470 445" stroke="#C9A24A" stroke-width="6" fill="none"/>
    <circle cx="300" cy="335" r="16" fill="#C9A24A"/>`, lin('vel', [[0, '#8F3CF7'], [1, '#4C169A']])),

  'kids-arabic-alphabet-blocks': () => svg(shadow(300, 500, 230) + ([[200, 400, '#7422E6', 'circle'], [400, 400, '#F59F00', 'star'], [300, 250, '#12B886', 'tri']] as const)
    .map(([x, y, c, k]) => `<g transform="translate(${x} ${y})"><rect x="-80" y="-80" width="160" height="160" rx="22" fill="${c}"/><rect x="-62" y="-62" width="124" height="124" rx="14" fill="#FFFFFF" opacity="0.92"/>${
      k === 'circle' ? `<circle r="38" fill="${c}"/>` : k === 'star' ? `<path d="M0 -44 L13 -14 L44 -12 L20 8 L28 40 L0 22 L-28 40 L-20 8 L-44 -12 L-13 -14 Z" fill="${c}"/>` : `<path d="M0 -42 L42 34 H-42 Z" fill="${c}"/>`
    }</g>`).join('')),

  'yoga-mat-6mm': () => svg(shadow(300, 480, 240) + `
    <rect x="120" y="300" width="360" height="150" rx="75" fill="url(#yoga)"/>
    <circle cx="195" cy="375" r="75" fill="#5F19C0"/><circle cx="195" cy="375" r="52" fill="#7422E6"/><circle cx="195" cy="375" r="30" fill="#8F3CF7"/><circle cx="195" cy="375" r="10" fill="#4C169A"/>
    <rect x="260" y="296" width="18" height="158" fill="#C39AFF" opacity="0.6"/><rect x="380" y="296" width="18" height="158" fill="#C39AFF" opacity="0.6"/>`, lin('yoga', [[0, '#A865FC'], [1, '#7422E6']])),
};

/** Home-slider picture: devices on a transparent background (the banner draws the purple and the text). */
export function heroDevicesArt(): string {
  return svg(
    laptop(330, 270, 0.95) + phone(140, 340, 0.6) + earbudsCase(330, 470, 0.6) + watch(500, 410, 0.55),
    laptopDefs + screenDefs + caseDefs,
    'none',
  );
}

/** Second slider picture: perfume bottles for the oud banner. */
export function heroPerfumeArt(): string {
  return svg(
    bottle(230, 360, 'url(#oud)', '#2A1A0F', 250, 190) + bottle(410, 400, 'url(#musk)', '#C9A24A', 180, 140),
    lin('oud', [[0, '#7A3E12'], [1, '#2E1505']]) + lin('musk', [[0, '#FFFFFF'], [1, '#E8E2F2']]),
    'none',
  );
}
