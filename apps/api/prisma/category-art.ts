/**
 * Category tile pictures: flat illustrations on a transparent background (no brands, no logos, no text), drawn as SVG
 * and turned into PNG by sharp. The tile puts its own background behind them and shows the picture in its bottom
 * corner, so everything stands on the bottom edge of a 600 × 600 canvas. The team can replace any of them with a
 * photo in the admin panel (Categories → picture).
 */

const W = 600;
const GROUND = 572;

const svg = (body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">` +
  `<defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>${defs}</defs>` +
  body + '</svg>';

/** soft contact shadow on the floor */
const shadow = (cx: number, rx: number, cy = GROUND + 6, ry = 16, o = 0.22) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#1b1033" opacity="${o}" filter="url(#blur)"/>`;
const lin = (id: string, stops: [number, string][], x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const rad = (id: string, stops: [number, string][], cx = 0.35, cy = 0.3, r = 0.75) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`;
/** a white shine stripe */
const shine = (x: number, y: number, w: number, h: number, o = 0.28, r = w / 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#FFFFFF" opacity="${o}"/>`;

const gold = lin('gold', [[0, '#F6DC94'], [0.5, '#D9AE4E'], [1, '#A97C22']], 0, 0, 1, 0);
const steel = lin('steel', [[0, '#F2F4F7'], [0.45, '#C3C8D2'], [1, '#8A909C']], 0, 0, 1, 0);

// ---------------------------------------------------------------------------------------------- the pictures

export const CATEGORY_ART: Record<string, () => string> = {
  /** over-ear headphones in front of a fabric speaker */
  electronics: () => svg(
    shadow(440, 140) + shadow(220, 170, GROUND + 8) +
    `<rect x="318" y="282" width="252" height="290" rx="46" fill="url(#spk)"/>
     <rect x="318" y="282" width="252" height="40" rx="20" fill="#FFFFFF" opacity="0.18"/>
     ${Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => `<circle cx="${352 + c * 23}" cy="${338 + r * 24}" r="5.5" fill="#B5400A" opacity="0.55"/>`).join('')).join('')}
     <rect x="420" y="268" width="48" height="16" rx="8" fill="#C2470B"/>
     <path d="M98 470 C 90 240, 350 240, 342 470" stroke="#1F2129" stroke-width="34" fill="none" stroke-linecap="round"/>
     <path d="M112 430 C 112 270, 328 270, 328 430" stroke="#3B3F4C" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.8"/>
     <rect x="58" y="400" width="104" height="172" rx="48" fill="url(#cup)"/>
     <rect x="140" y="420" width="40" height="132" rx="20" fill="#121318"/>
     <rect x="278" y="400" width="104" height="172" rx="48" fill="url(#cup)"/>
     <rect x="260" y="420" width="40" height="132" rx="20" fill="#121318"/>
     ${shine(74, 420, 14, 110, 0.18)}${shine(294, 420, 14, 110, 0.18)}`,
    lin('spk', [[0, '#FF9A4D'], [1, '#E2560B']]) + lin('cup', [[0, '#3A3E4B'], [1, '#14161C']], 0, 0, 1, 1),
  ),

  /** a phone with apps, wireless earbuds and a cable */
  'phones-accessories': () => svg(
    shadow(360, 130) + shadow(140, 110) +
    `<g transform="rotate(8 360 380)">
       <rect x="262" y="140" width="210" height="432" rx="38" fill="#1C1F2A"/>
       <rect x="272" y="150" width="190" height="412" rx="30" fill="url(#scr)"/>
       <rect x="335" y="160" width="64" height="18" rx="9" fill="#0B0D14"/>
       ${Array.from({ length: 12 }, (_, i) => `<rect x="${292 + (i % 4) * 41}" y="${210 + Math.floor(i / 4) * 46}" width="30" height="30" rx="9" fill="#FFFFFF" opacity="${0.55 + (i % 3) * 0.15}"/>`).join('')}
       <rect x="292" y="500" width="150" height="40" rx="20" fill="#FFFFFF" opacity="0.25"/>
       ${shine(282, 170, 10, 360, 0.12)}
     </g>
     <path d="M210 560 C 250 600, 300 520, 250 470 C 220 440, 240 410, 270 410" stroke="#F1F2F6" stroke-width="12" fill="none" stroke-linecap="round"/>
     <rect x="60" y="458" width="164" height="114" rx="52" fill="url(#case)" stroke="#DADDE5" stroke-width="3"/>
     <path d="M62 500 H222" stroke="#CDD1DA" stroke-width="3"/>
     <circle cx="142" cy="530" r="5" fill="#69DB7C"/>`,
    lin('scr', [[0, '#C13CFE'], [0.55, '#7422E6'], [1, '#2A0D63']], 0, 0, 0.6, 1) + lin('case', [[0, '#FFFFFF'], [1, '#E3E6EC']]),
  ),

  /** an open laptop and a mouse */
  computers: () => svg(
    shadow(290, 250) + shadow(520, 50) +
    `<rect x="70" y="240" width="440" height="290" rx="18" fill="#252833"/>
     <rect x="84" y="254" width="412" height="262" rx="8" fill="url(#lap)"/>
     <rect x="104" y="276" width="150" height="16" rx="8" fill="#FFFFFF" opacity="0.55"/>
     <rect x="104" y="306" width="372" height="120" rx="12" fill="#FFFFFF" opacity="0.14"/>
     <rect x="104" y="440" width="176" height="56" rx="10" fill="#FFFFFF" opacity="0.2"/><rect x="296" y="440" width="180" height="56" rx="10" fill="#FFFFFF" opacity="0.2"/>
     <path d="M30 530 H550 L528 560 H52 Z" fill="url(#alu)"/>
     <rect x="250" y="530" width="80" height="9" rx="4.5" fill="#9AA0AD"/>
     <path d="M30 530 H550" stroke="#FFFFFF" stroke-width="3" opacity="0.6"/>
     <ellipse cx="522" cy="545" rx="42" ry="28" fill="url(#mouse)"/><path d="M522 518 V540" stroke="#9AA0AD" stroke-width="3"/>`,
    lin('lap', [[0, '#1E0B45'], [0.55, '#5F19C0'], [1, '#C13CFE']], 0, 0, 1, 1) + lin('alu', [[0, '#EEF0F4'], [1, '#AEB4C0']]) + lin('mouse', [[0, '#F5F6F9'], [1, '#C9CDD6']]),
  ),

  /** two game controllers */
  gaming: () => svg(
    shadow(300, 250) +
    `<g transform="translate(360 350) rotate(14) scale(0.82)">${pad('url(#padB)', '#2A2D38', '#C13CFE')}</g>
     <g transform="translate(250 430) rotate(-10)">${pad('url(#padW)', '#1A1C24', '#7422E6')}</g>`,
    lin('padW', [[0, '#FFFFFF'], [1, '#D4D1DE']]) + lin('padB', [[0, '#5F19C0'], [1, '#2A0D63']]),
  ),

  /** a dress on a hanger and folded jeans */
  fashion: () => svg(
    shadow(250, 150) + shadow(470, 110) +
    `<path d="M250 60 C 250 30, 290 30, 290 56 C 290 76, 262 78, 262 96" stroke="url(#steel)" stroke-width="8" fill="none" stroke-linecap="round"/>
     <path d="M262 96 L150 156 H374 Z" fill="none" stroke="url(#steel)" stroke-width="8" stroke-linejoin="round"/>
     <path d="M200 150 C 220 172, 304 172, 324 150 L330 250 C 334 300, 330 320, 340 340 L 420 572 H104 L184 340 C 194 320, 190 300, 194 250 Z" fill="url(#dress)"/>
     <path d="M194 250 C 230 268, 294 268, 330 250" stroke="#8E0E1C" stroke-width="10" fill="none"/>
     <path d="M262 300 L230 572 M262 300 L300 572" stroke="#8E0E1C" stroke-width="4" opacity="0.35"/>
     ${shine(206, 180, 14, 120, 0.2)}
     ${[0, 1, 2].map((i) => `<g transform="translate(470 ${540 - i * 46})">
        <rect x="-96" y="-22" width="192" height="46" rx="10" fill="${['#2B5FA8', '#3C74C2', '#244F8E'][i]}"/>
        <path d="M-84 0 H84" stroke="#F2C76B" stroke-width="2.5" stroke-dasharray="7 6"/>
      </g>`).join('')}`,
    steel + lin('dress', [[0, '#F0384B'], [1, '#B3121F']]),
  ),

  /** a white sneaker with purple details */
  shoes: () => svg(
    shadow(300, 250, GROUND + 4) +
    `<path d="M66 512 H540 C 566 512, 570 566, 536 568 H86 C 52 568, 46 512, 66 512 Z" fill="#F7F7FA"/>
     <path d="M60 548 H560" stroke="#D9DBE3" stroke-width="12" stroke-linecap="round"/>
     <path d="M70 520 H556" stroke="#8F3CF7" stroke-width="8" opacity="0.9"/>
     <path d="M82 514 C 66 440, 70 380, 92 334 C 112 298, 172 296, 214 324 L300 268 C 324 254, 344 266, 336 290 C 380 350, 450 384, 512 400 C 560 412, 574 470, 560 514 Z" fill="url(#upper)" stroke="#BDB6CF" stroke-width="5" stroke-linejoin="round"/>
     <path d="M84 512 C 70 440, 74 390, 92 350 L150 360 C 140 410, 140 470, 150 512 Z" fill="#7422E6"/>
     <path d="M92 334 C 112 298, 172 296, 214 324 C 180 330, 130 340, 92 334 Z" fill="#E9E4F5"/>
     <path d="M120 480 C 200 470, 300 420, 380 420 C 330 450, 260 492, 150 500 Z" fill="#7422E6"/>
     <path d="M440 470 C 480 452, 530 452, 556 470 L560 514 H440 Z" fill="#ECE9F3"/>
     ${[0, 1, 2, 3, 4].map((i) => `<path d="M${262 + i * 28} ${318 + i * 18} l 34 -16" stroke="#3B3F4C" stroke-width="7" stroke-linecap="round"/>`).join('')}
     <path d="M96 360 C 92 420, 96 470, 104 510" stroke="#FFFFFF" stroke-width="8" opacity="0.7" fill="none" stroke-linecap="round"/>`,
    lin('upper', [[0, '#FFFFFF'], [1, '#DCDDE6']], 0, 0, 0, 1),
  ),

  /** a red handbag and a small clutch */
  bags: () => svg(
    shadow(330, 220) +
    `<path d="M236 300 C 236 150, 424 150, 424 300" stroke="#7E0F1A" stroke-width="22" fill="none" stroke-linecap="round"/>
     <path d="M236 300 C 236 166, 424 166, 424 300" stroke="#C7283A" stroke-width="7" fill="none" opacity="0.6"/>
     <path d="M168 296 H492 C 512 296, 520 306, 524 324 L560 548 C 563 562, 554 572, 540 572 H120 C 106 572, 97 562, 100 548 L136 324 C 140 306, 148 296, 168 296 Z" fill="url(#bag)"/>
     <path d="M146 296 H514 L522 380 C 440 410, 220 410, 138 380 Z" fill="#C51F31"/>
     <rect x="310" y="372" width="40" height="50" rx="8" fill="url(#gold)"/><rect x="321" y="386" width="18" height="18" rx="4" fill="#8A6418"/>
     ${shine(150, 412, 14, 130, 0.18)}
     <g transform="translate(110 520) rotate(-8)">
       <rect x="-80" y="-50" width="160" height="96" rx="20" fill="url(#clutch)"/>
       <path d="M-80 -10 C -30 18, 30 18, 80 -10" stroke="#C9A98A" stroke-width="5" fill="none"/>
       <circle cx="0" cy="12" r="8" fill="url(#gold)"/>
     </g>`,
    gold + lin('bag', [[0, '#EE3B4E'], [1, '#A5121F']]) + lin('clutch', [[0, '#F4E4D2'], [1, '#D8BFA4']]),
  ),

  /** a lipstick and an eyeshadow palette */
  beauty: () => svg(
    shadow(410, 170) + shadow(150, 60) +
    `<rect x="250" y="300" width="330" height="272" rx="22" fill="#17181E"/>
     <rect x="262" y="236" width="306" height="70" rx="14" fill="#2A2C35"/><rect x="276" y="246" width="278" height="50" rx="10" fill="url(#mirror)"/>
     ${['#F2C4B5', '#E8A493', '#D98472', '#C9907A', '#B5604F', '#E5B3A3', '#9E4A3E', '#C77B68', '#F0D4C6'].map((c, i) => `<rect x="${272 + (i % 3) * 100}" y="${318 + Math.floor(i / 3) * 82}" width="86" height="70" rx="10" fill="${c}"/><rect x="${280 + (i % 3) * 100}" y="${324 + Math.floor(i / 3) * 82}" width="30" height="10" rx="5" fill="#FFFFFF" opacity="0.35"/>`).join('')}
     <rect x="106" y="420" width="88" height="152" rx="10" fill="#15161B"/>
     ${shine(114, 428, 12, 136, 0.2)}
     <rect x="112" y="356" width="76" height="70" rx="6" fill="url(#gold)"/>
     <path d="M122 356 V262 C 122 240, 170 214, 178 226 V356 Z" fill="url(#lip)"/>
     ${shine(130, 270, 9, 80, 0.3)}`,
    gold + lin('lip', [[0, '#C9525F'], [1, '#8E2433']], 0, 0, 1, 0) + lin('mirror', [[0, '#E9ECF2'], [1, '#B6BCC8']], 0, 0, 1, 1),
  ),

  /** two perfume bottles */
  perfumes: () => svg(
    shadow(250, 150) + shadow(450, 100) +
    `<rect x="132" y="300" width="236" height="272" rx="34" fill="url(#glassA)"/>
     <rect x="148" y="372" width="204" height="184" rx="24" fill="url(#liqA)"/>
     ${shine(152, 318, 22, 230, 0.35)}
     <rect x="216" y="262" width="68" height="44" rx="8" fill="url(#gold)"/>
     <rect x="196" y="176" width="108" height="92" rx="18" fill="#1D1426"/>${shine(206, 186, 14, 70, 0.22)}
     <rect x="380" y="380" width="160" height="192" rx="26" fill="url(#glassB)"/>
     <rect x="392" y="430" width="136" height="128" rx="18" fill="url(#liqB)"/>
     ${shine(392, 394, 16, 160, 0.35)}
     <rect x="432" y="352" width="56" height="32" rx="6" fill="url(#gold)"/>
     <circle cx="460" cy="320" r="36" fill="url(#gold)"/>${shine(446, 296, 10, 34, 0.35)}`,
    gold + lin('glassA', [[0, '#F3E8FF'], [1, '#D6C2F5']]) + lin('liqA', [[0, '#B57CF8'], [1, '#6A1FD0']]) +
      lin('glassB', [[0, '#FFF4E3'], [1, '#F2DCC0']]) + lin('liqB', [[0, '#F0B04D'], [1, '#B86A10']]),
  ),

  /** a pump bottle, a cream tube and a jar */
  'health-personal-care': () => svg(
    shadow(230, 110) + shadow(430, 150) +
    `<rect x="160" y="290" width="140" height="282" rx="30" fill="url(#pump)"/>
     <rect x="160" y="380" width="140" height="110" fill="#12B886"/><path d="M186 435 h88 M230 405 v60" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>
     ${shine(172, 300, 14, 250, 0.4)}
     <rect x="200" y="240" width="60" height="54" rx="8" fill="#E9ECEF"/><rect x="220" y="190" width="20" height="56" fill="#CED4DA"/>
     <path d="M220 192 H290 V212 H240" fill="#CED4DA"/>
     <g transform="rotate(-6 440 520)">
       <path d="M310 490 H520 L560 470 V560 L520 540 H310 C 298 540, 296 490, 310 490 Z" fill="url(#tube)"/>
       <rect x="282" y="494" width="34" height="42" rx="6" fill="#7422E6"/>
       <rect x="360" y="500" width="120" height="30" rx="6" fill="#FFFFFF" opacity="0.85"/>
     </g>
     <rect x="380" y="380" width="150" height="100" rx="20" fill="url(#jar)"/><rect x="372" y="360" width="166" height="36" rx="12" fill="#7422E6"/>
     ${shine(392, 400, 12, 64, 0.4)}`,
    lin('pump', [[0, '#FFFFFF'], [1, '#DEE2E6']], 0, 0, 1, 0) + lin('tube', [[0, '#FFFFFF'], [1, '#D7DBE2']]) + lin('jar', [[0, '#F8F0FF'], [1, '#DCCBF6']]),
  ),

  /** a cooking pot with a glass lid, a wooden spoon and a mug */
  'home-kitchen': () => svg(
    shadow(270, 210) + shadow(500, 70) +
    `<rect x="90" y="330" width="360" height="242" rx="34" fill="url(#pot)"/>
     ${shine(108, 352, 18, 190, 0.18)}
     <rect x="40" y="370" width="64" height="30" rx="14" fill="#1C1E25"/><rect x="436" y="370" width="64" height="30" rx="14" fill="#1C1E25"/>
     <path d="M80 330 Q270 230 460 330 Z" fill="url(#lid)" stroke="#9AA0AD" stroke-width="5"/>
     <rect x="246" y="262" width="48" height="26" rx="12" fill="#1C1E25"/>
     <rect x="455" y="460" width="100" height="112" rx="16" fill="url(#mug)"/>
     <path d="M555 486 C 600 486, 600 546, 555 546" stroke="#6A1FD0" stroke-width="13" fill="none"/>
     ${shine(466, 472, 10, 80, 0.3)}`,
    lin('pot', [[0, '#4A4F5E'], [1, '#1F222B']], 0, 0, 1, 0) + lin('lid', [[0, '#EEF4FA'], [1, '#B8C4D3']]) + lin('mug', [[0, '#A865FC'], [1, '#6A1FD0']]),
  ),

  /** a velvet armchair and a plant */
  furniture: () => svg(
    shadow(270, 230) + shadow(510, 60) +
    `<path d="M120 300 C 120 180, 420 180, 420 300 V430 H120 Z" fill="url(#velvet)"/>
     ${[180, 270, 360].map((x) => `<path d="M${x} 220 V400" stroke="#4C169A" stroke-width="4" opacity="0.45"/>`).join('')}
     <rect x="100" y="420" width="340" height="80" rx="30" fill="url(#seat)"/>
     <rect x="60" y="350" width="86" height="170" rx="38" fill="url(#velvet)"/><rect x="394" y="350" width="86" height="170" rx="38" fill="url(#velvet)"/>
     <rect x="76" y="500" width="390" height="22" rx="8" fill="#3F1585"/>
     <path d="M100 520 L88 572 M440 520 L452 572 M180 520 L176 560 M360 520 L364 560" stroke="#B07A45" stroke-width="12" stroke-linecap="round"/>
     ${shine(74, 366, 12, 120, 0.2)}${shine(146, 220, 14, 160, 0.14)}
     <path d="M510 470 C 470 380, 470 330, 500 290 M510 470 C 540 390, 560 360, 580 330 M510 470 C 500 410, 520 370, 530 330" stroke="#2F9E44" stroke-width="7" fill="none" stroke-linecap="round"/>
     ${[[490, 300], [500, 350], [530, 340], [570, 340], [550, 390], [478, 400]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="22" ry="11" transform="rotate(${i * 50} ${x} ${y})" fill="${i % 2 ? '#40C057' : '#2F9E44'}"/>`).join('')}
     <path d="M468 470 H552 L540 572 H480 Z" fill="url(#potC)"/>`,
    lin('velvet', [[0, '#9A4DFA'], [1, '#5A1BB8']]) + lin('seat', [[0, '#A865FC'], [1, '#6A1FD0']]) + lin('potC', [[0, '#F1E3D3'], [1, '#CDB49A']]),
  ),

  /** a paper grocery bag with bread, greens, milk and fruit */
  groceries: () => svg(
    shadow(300, 200) +
    `<path d="M300 300 L400 90" stroke="#D9A75C" stroke-width="44" stroke-linecap="round"/>
     ${[0, 1, 2, 3].map((i) => `<path d="M${318 + i * 22} ${250 - i * 46} l 26 10" stroke="#B9823A" stroke-width="5" stroke-linecap="round"/>`).join('')}
     <rect x="330" y="170" width="78" height="150" rx="8" fill="#FFFFFF"/><path d="M330 170 L369 132 L408 170 Z" fill="#E9ECEF"/><rect x="330" y="222" width="78" height="44" fill="#4DABF7"/>
     ${[[170, 230, -30], [200, 200, -10], [235, 214, 15], [150, 268, -50]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="26" ry="62" transform="rotate(${r} ${x} ${y})" fill="#37B24D"/><path d="M${x} ${y + 50} L${x} ${y - 50}" transform="rotate(${r} ${x} ${y})" stroke="#2B8A3E" stroke-width="4"/>`).join('')}
     <path d="M440 270 L470 200" stroke="#2F9E44" stroke-width="10" stroke-linecap="round"/><path d="M430 300 L470 220 L486 300 Z" fill="#FD7E14"/>
     <path d="M150 300 H450 L470 572 H130 Z" fill="url(#paper)"/>
     <path d="M150 300 H450 L452 330 H148 Z" fill="#B88A55"/>
     <path d="M150 300 L172 572 M450 300 L428 572" stroke="#B88A55" stroke-width="4" opacity="0.6"/>
     <circle cx="226" cy="520" r="42" fill="url(#apple)"/><path d="M226 480 Q236 462 248 464" stroke="#5C3311" stroke-width="5" fill="none"/>${shine(208, 496, 10, 24, 0.4)}
     <circle cx="300" cy="536" r="34" fill="#FAB005"/><circle cx="364" cy="526" r="40" fill="url(#orange)"/>${shine(348, 502, 10, 22, 0.35)}`,
    lin('paper', [[0, '#E2BC86'], [1, '#C79A60']]) + rad('apple', [[0, '#FF6B6B'], [1, '#C92A2A']]) + rad('orange', [[0, '#FFA94D'], [1, '#E8590C']]),
  ),

  /** a bag of chips, a chocolate bar and a cookie */
  'food-snacks': () => svg(
    shadow(230, 140) + shadow(450, 130) +
    `<path d="M120 196 L340 196 L330 230 C 350 330, 350 470, 330 548 L340 572 H120 L130 548 C 110 470, 110 330, 130 230 Z" fill="url(#chips)"/>
     <path d="M120 196 L132 186 L144 196 L156 186 L168 196 L180 186 L192 196 L204 186 L216 196 L228 186 L240 196 L252 186 L264 196 L276 186 L288 196 L300 186 L312 196 L324 186 L340 196 Z" fill="#E8590C"/>
     <circle cx="230" cy="380" r="70" fill="#FFF3BF"/><path d="M200 380 L230 340 L262 384 L230 420 Z" fill="#FAB005"/>
     ${shine(144, 240, 16, 280, 0.25)}
     <g transform="rotate(-14 450 470)">
       <rect x="350" y="400" width="210" height="110" rx="10" fill="#4C169A"/>
       <rect x="350" y="400" width="80" height="110" fill="#5C3311"/>
       ${[0, 1].map((r) => `<rect x="${358}" y="${408 + r * 52}" width="30" height="44" rx="4" fill="#7A4A22"/><rect x="${394}" y="${408 + r * 52}" width="30" height="44" rx="4" fill="#7A4A22"/>`).join('')}
       <path d="M430 400 L446 416 L432 432 L448 448 L432 464 L448 480 L432 496 L430 510" fill="#4C169A" stroke="#C39AFF" stroke-width="3"/>
       <rect x="470" y="430" width="70" height="50" rx="6" fill="url(#gold)"/>
     </g>
     <circle cx="480" cy="540" r="44" fill="url(#cookie)"/>${[[466, 526], [494, 548], [470, 556], [498, 522]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#5C3311"/>`).join('')}`,
    gold + lin('chips', [[0, '#FF922B'], [1, '#E8590C']], 0, 0, 1, 0) + rad('cookie', [[0, '#F2C27A'], [1, '#C88A3A']]),
  ),

  /** a teddy bear next to toy blocks */
  'baby-kids': () => svg(
    shadow(230, 160) + shadow(470, 110) +
    `<circle cx="150" cy="190" r="40" fill="#A86B3C"/><circle cx="310" cy="190" r="40" fill="#A86B3C"/><circle cx="150" cy="190" r="20" fill="#E7B98C"/><circle cx="310" cy="190" r="20" fill="#E7B98C"/>
     <ellipse cx="230" cy="470" rx="120" ry="104" fill="url(#fur)"/><ellipse cx="230" cy="480" rx="64" ry="62" fill="#E7B98C"/>
     <circle cx="230" cy="270" r="100" fill="url(#fur)"/><ellipse cx="230" cy="306" rx="46" ry="36" fill="#E7B98C"/>
     <ellipse cx="230" cy="290" rx="16" ry="11" fill="#3B2210"/><path d="M230 300 V318 M214 322 Q230 334 246 322" stroke="#3B2210" stroke-width="5" fill="none" stroke-linecap="round"/>
     <circle cx="196" cy="252" r="10" fill="#1F1208"/><circle cx="264" cy="252" r="10" fill="#1F1208"/><circle cx="199" cy="249" r="3" fill="#FFFFFF"/><circle cx="267" cy="249" r="3" fill="#FFFFFF"/>
     <ellipse cx="140" cy="540" rx="50" ry="34" fill="url(#fur)"/><ellipse cx="320" cy="540" rx="50" ry="34" fill="url(#fur)"/>
     <path d="M190 360 Q230 384 270 360 L262 392 Q230 404 198 392 Z" fill="#7422E6"/>
     ${block(470, 512, '#7422E6', 'circle')}${block(400, 512, '#FAB005', 'tri', 0.85)}${block(440, 400, '#12B886', 'star', 0.85)}`,
    rad('fur', [[0, '#C98B55'], [1, '#8A5226']], 0.4, 0.35, 0.8),
  ),

  /** a football and a dumbbell */
  'sports-fitness': () => svg(
    shadow(250, 150) + shadow(460, 130) +
    `<circle cx="250" cy="430" r="142" fill="url(#ball)"/>
     <path d="M250 372 L306 412 L284 478 H216 L194 412 Z" fill="#1F2129"/>
     <path d="M250 372 V300 M306 412 L370 388 M284 478 L322 540 M216 478 L178 540 M194 412 L130 388" stroke="#1F2129" stroke-width="6"/>
     <path d="M226 290 L274 290 L250 300 Z M372 360 L392 420 L370 390 Z M340 548 L300 566 L322 540 Z M160 548 L200 566 L178 540 Z M108 420 L128 360 L130 390 Z" fill="#1F2129"/>
     ${shine(176, 330, 26, 60, 0.35)}
     <rect x="356" y="508" width="230" height="22" rx="11" fill="url(#steel)"/>
     ${[[372, 70], [400, 100], [516, 100], [544, 70]].map(([x, h], i) => `<rect x="${x}" y="${519 - h / 2}" width="26" height="${h}" rx="9" fill="${i === 1 || i === 2 ? '#7422E6' : '#5F19C0'}"/>${shine(x + 5, 519 - h / 2 + 8, 6, h - 16, 0.3)}`).join('')}`,
    steel + rad('ball', [[0, '#FFFFFF'], [0.8, '#E9ECEF'], [1, '#C9CDD6']], 0.35, 0.3, 0.8),
  ),

  /** a car seen from the side */
  automotive: () => svg(
    shadow(300, 260, GROUND + 2, 14, 0.28) +
    `<path d="M40 470 C 40 420, 70 400, 120 392 L190 310 C 210 290, 230 282, 262 282 H372 C 400 282, 420 292, 440 312 L500 380 C 540 386, 568 404, 572 440 L574 500 C 574 512, 566 520, 552 520 H58 C 46 520, 40 512, 40 500 Z" fill="url(#car)"/>
     <path d="M206 322 C 216 308, 230 302, 252 302 H300 V384 H150 Z" fill="url(#win)"/>
     <path d="M318 302 H370 C 392 302, 404 310, 418 324 L466 384 H318 Z" fill="url(#win)"/>
     <path d="M60 440 H560" stroke="#FFFFFF" stroke-width="4" opacity="0.25"/>
     <rect x="530" y="420" width="34" height="16" rx="6" fill="#FFE066"/><rect x="40" y="430" width="22" height="16" rx="6" fill="#FF6B6B"/>
     ${[150, 460].map((x) => `<circle cx="${x}" cy="518" r="56" fill="#16171C"/><circle cx="${x}" cy="518" r="32" fill="url(#steel)"/><circle cx="${x}" cy="518" r="10" fill="#5A5F6B"/>`).join('')}`,
    steel + lin('car', [[0, '#A865FC'], [1, '#5A1BB8']]) + lin('win', [[0, '#D0EBFF'], [1, '#74C0FC']], 0, 0, 1, 1),
  ),

  /** a hammer, a wrench and a screwdriver */
  tools: () => svg(
    shadow(300, 220) +
    `<g transform="rotate(32 300 380)">
       <rect x="282" y="250" width="36" height="330" rx="14" fill="url(#wood)"/>
       <rect x="200" y="184" width="200" height="74" rx="12" fill="url(#steel)"/><path d="M400 192 L456 214 L400 250 Z" fill="#9AA0AD"/>
       ${shine(290, 270, 8, 280, 0.25)}
     </g>
     <g transform="rotate(-34 300 380)">
       <rect x="282" y="230" width="36" height="320" rx="12" fill="url(#steel)"/>
       <path d="M262 200 C 232 168, 236 112, 272 98 L284 148 H316 L328 98 C 364 112, 368 168, 338 200 L318 236 H282 Z" fill="url(#steel)"/>
       <circle cx="300" cy="556" r="36" fill="url(#steel)"/><circle cx="300" cy="556" r="17" fill="#7C828E"/><circle cx="300" cy="556" r="9" fill="#C3C8D2"/>
     </g>
     <g transform="rotate(-70 430 470)">
       <rect x="412" y="300" width="36" height="140" rx="16" fill="#E03131"/><rect x="420" y="310" width="8" height="120" rx="4" fill="#FFFFFF" opacity="0.3"/>
       <rect x="422" y="440" width="16" height="150" rx="4" fill="url(#steel)"/><path d="M422 590 L430 612 L438 590 Z" fill="#9AA0AD"/>
     </g>`,
    steel + lin('wood', [[0, '#E0A96D'], [1, '#A86B3C']], 0, 0, 1, 0),
  ),

  /** a food bowl, a bone and a ball */
  'pet-supplies': () => svg(
    shadow(250, 200) + shadow(490, 60) +
    `<path d="M70 430 H430 L398 560 C 394 568, 386 572, 376 572 H124 C 114 572, 106 568, 102 560 Z" fill="url(#bowl)"/>
     <ellipse cx="250" cy="430" rx="180" ry="38" fill="#4C169A"/>
     ${Array.from({ length: 22 }, (_, i) => `<circle cx="${112 + (i * 61) % 276}" cy="${414 + (i * 17) % 26}" r="14" fill="${i % 3 ? '#B5733A' : '#8A5226'}"/>`).join('')}
     ${shine(100, 452, 14, 80, 0.22)}
     <g transform="translate(70 178) rotate(-8 390 330)"><path d="M300 300 C 286 280, 304 262, 318 274 C 322 260, 344 262, 344 280 L448 336 C 464 328, 482 340, 474 358 C 490 364, 486 388, 466 384 C 462 400, 440 400, 436 384 L330 328 C 316 340, 296 332, 300 314 C 284 312, 286 294, 300 300 Z" fill="url(#bone)"/></g>
     <circle cx="470" cy="420" r="40" fill="url(#tball)"/><path d="M436 404 C 460 420, 484 420, 506 404 M436 436 C 460 420, 484 420, 506 436" stroke="#FFFFFF" stroke-width="5" fill="none"/>`,
    lin('bowl', [[0, '#9A4DFA'], [1, '#5A1BB8']], 0, 0, 1, 0) + lin('bone', [[0, '#FFF8EC'], [1, '#E9D8BE']]) + rad('tball', [[0, '#D8F5A2'], [1, '#82C91E']]),
  ),

  /** a stack of books and a cup of pencils */
  'office-stationery': () => svg(
    shadow(300, 250) +
    `${[[96, 510, 420, 62, '#3B5BDB'], [116, 448, 380, 62, '#E03131'], [86, 386, 360, 62, '#12B886']].map(([x, y, w, h, c]) => `
       <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${c}"/>
       <rect x="${(x as number) + 14}" y="${(y as number) + 10}" width="${(w as number) - 14}" height="${(h as number) - 20}" rx="4" fill="#FAF7F0"/>
       ${[0, 1, 2].map((k) => `<path d="M${(x as number) + 20} ${(y as number) + 18 + k * 13} H${(x as number) + (w as number) - 6}" stroke="#E2DCCB" stroke-width="2"/>`).join('')}
       <rect x="${x}" y="${y}" width="22" height="${h}" rx="6" fill="${c}"/>`).join('')}
     <path d="M140 386 V340 L160 352 L180 340 V386" fill="#FAB005"/>
     ${[[350, 160, '#E03131', -8], [384, 130, '#FAB005', 0], [418, 150, '#3B5BDB', 8], [452, 176, '#12B886', 14], [400, 190, '#7422E6', 4]].map(([x, y, c, r]) => `<g transform="rotate(${r} ${x} 330)"><rect x="${(x as number) - 11}" y="${y}" width="22" height="${330 - (y as number)}" fill="${c}"/><path d="M${(x as number) - 11} ${y} L${x} ${(y as number) - 30} L${(x as number) + 11} ${y} Z" fill="#F4D6A8"/><path d="M${(x as number) - 4} ${(y as number) - 19} L${x} ${(y as number) - 30} L${(x as number) + 4} ${(y as number) - 19} Z" fill="#2B2F3A"/></g>`).join('')}
     <path d="M330 270 H480 L470 386 H340 Z" fill="url(#cupP)"/>${shine(344, 284, 12, 80, 0.3)}`,
    lin('cupP', [[0, '#74C0FC'], [1, '#1C7ED6']], 0, 0, 1, 0),
  ),

  /** a suitcase and a passport */
  travel: () => svg(
    shadow(300, 170) + shadow(480, 70) +
    `<path d="M250 200 V150 C 250 130, 260 120, 280 120 H320 C 340 120, 350 130, 350 150 V200" stroke="#2A2D38" stroke-width="18" fill="none"/>
     <rect x="170" y="196" width="260" height="350" rx="34" fill="url(#case)"/>
     ${[230, 300, 370].map((x) => `<rect x="${x - 8}" y="210" width="16" height="322" rx="8" fill="#FFFFFF" opacity="0.16"/>`).join('')}
     <rect x="170" y="350" width="260" height="20" fill="#4C169A" opacity="0.6"/>
     ${shine(184, 216, 12, 300, 0.25)}
     ${[208, 392].map((x) => `<rect x="${x - 14}" y="540" width="28" height="18" rx="4" fill="#2A2D38"/><circle cx="${x}" cy="562" r="12" fill="#16171C"/>`).join('')}
     <g transform="rotate(10 480 480)">
       <rect x="410" y="380" width="140" height="190" rx="12" fill="#7A1F2B"/>
       <circle cx="480" cy="460" r="34" fill="none" stroke="url(#gold)" stroke-width="5"/>
       <path d="M446 460 H514 M480 426 C 460 446, 460 474, 480 494 C 500 474, 500 446, 480 426" stroke="url(#gold)" stroke-width="4" fill="none"/>
       <rect x="440" y="520" width="80" height="10" rx="5" fill="url(#gold)"/>
     </g>`,
    gold + lin('case', [[0, '#A865FC'], [1, '#5A1BB8']], 0, 0, 1, 1),
  ),

  /** two wrapped gift boxes */
  gifts: () => svg(
    shadow(260, 200) + shadow(480, 90) +
    `<rect x="90" y="330" width="330" height="242" rx="14" fill="url(#boxA)"/>
     <rect x="70" y="282" width="370" height="70" rx="14" fill="#8F3CF7"/>
     <rect x="232" y="282" width="46" height="290" fill="url(#gold)"/><rect x="90" y="410" width="330" height="0"/>
     <path d="M255 284 C 180 200, 120 240, 170 284 Z" fill="url(#gold)"/><path d="M255 284 C 330 200, 390 240, 340 284 Z" fill="url(#gold)"/>
     <circle cx="255" cy="282" r="20" fill="#B98D2E"/>
     ${shine(100, 350, 14, 200, 0.2)}
     <rect x="410" y="430" width="160" height="142" rx="10" fill="url(#boxB)"/>
     <rect x="398" y="408" width="184" height="40" rx="10" fill="#F783AC"/>
     <rect x="476" y="408" width="28" height="164" fill="#FFFFFF" opacity="0.9"/>
     <path d="M490 410 C 450 360, 420 390, 450 410 Z M490 410 C 530 360, 560 390, 530 410 Z" fill="#FFFFFF"/>`,
    gold + lin('boxA', [[0, '#7422E6'], [1, '#4C169A']]) + lin('boxB', [[0, '#FAA2C1'], [1, '#E64980']]),
  ),

  /** shopping bags */
  other: () => svg(
    shadow(280, 230) +
    `<path d="M300 260 C 300 170, 420 170, 420 260" stroke="#4C169A" stroke-width="14" fill="none"/>
     <path d="M250 260 H470 L500 572 H220 Z" fill="url(#bagP)"/>${shine(262, 280, 14, 250, 0.2)}
     <path d="M140 330 C 140 250, 250 250, 250 330" stroke="#ADB5BD" stroke-width="12" fill="none"/>
     <path d="M100 330 H290 L310 572 H80 Z" fill="url(#bagW)"/>
     <circle cx="195" cy="450" r="40" fill="#7422E6"/><path d="M178 450 L192 464 L216 436" stroke="#FFFFFF" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    lin('bagP', [[0, '#A865FC'], [1, '#5A1BB8']], 0, 0, 1, 1) + lin('bagW', [[0, '#FFFFFF'], [1, '#E3E6EC']], 0, 0, 1, 1),
  ),
};

/** a game controller centred on 0,0 */
function pad(body: string, dark: string, accent: string) {
  return `<path d="M-150 -70 C -110 -130, 110 -130, 150 -70 C 200 0, 240 130, 170 150 C 120 165, 100 90, 60 80 H-60 C -100 90, -120 165, -170 150 C -240 130, -200 0, -150 -70 Z" fill="${body}"/>
    <circle cx="-85" cy="0" r="34" fill="${dark}"/><circle cx="-85" cy="0" r="21" fill="#3A3E4C"/>
    <circle cx="50" cy="50" r="30" fill="${dark}"/><circle cx="50" cy="50" r="18" fill="#3A3E4C"/>
    <rect x="-68" y="38" width="16" height="48" rx="4" fill="${dark}"/><rect x="-84" y="54" width="48" height="16" rx="4" fill="${dark}"/>
    ${[[95, -35], [130, -5], [60, -5], [95, 25]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="15" fill="${i % 2 ? accent : '#FFFFFF'}" stroke="${dark}" stroke-width="3"/>`).join('')}
    <rect x="-20" y="-50" width="40" height="10" rx="5" fill="${accent}"/>`;
}

/** a toy block with a shape on it, standing on the floor at x */
function block(x: number, y: number, c: string, k: 'circle' | 'tri' | 'star', s = 1) {
  const shape = k === 'circle' ? `<circle r="30" fill="${c}"/>`
    : k === 'star' ? `<path d="M0 -36 L11 -11 L36 -10 L16 7 L23 33 L0 18 L-23 33 L-16 7 L-36 -10 L-11 -11 Z" fill="${c}"/>`
    : `<path d="M0 -34 L34 28 H-34 Z" fill="${c}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-62" y="-62" width="124" height="124" rx="18" fill="${c}"/><rect x="-48" y="-48" width="96" height="96" rx="12" fill="#FFFFFF" opacity="0.94"/>${shape}</g>`;
}

export const CATEGORY_ART_SLUGS = Object.keys(CATEGORY_ART);
