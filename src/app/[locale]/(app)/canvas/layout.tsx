/* ────────────────────────────────────────────────────────────────────
   Canvas route layout — next/font/google 로 theme x font variant preload.
   variable mode 로 각 폰트가 자체 CSS variable 만들어주고 canvas-board 가
   inline style 로 활성 폰트 적용 (--canvas-card-header-font 주입).

   적용 범위: /canvas 안에서만. 다른 라우트는 영향 X.

   - subsets: ['latin'] — 한국어는 Pretendard fallback 으로 해결.
   - weight: 사용할 weight 만 (400 ~ 700) — 번들 최소화.
   - display: 'swap' — 로딩 중 fallback 노출 (FOIT 회피).

   ⚠️ next/font/google 의 loader 는 인자를 inline literal 로만 받음
   (spread / 변수 사용 금지) — 그래서 옵션을 매 호출마다 직접 작성.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import {
  Inter,
  Geist,
  Manrope,
  Instrument_Serif,
  JetBrains_Mono,
  IBM_Plex_Mono,
  Geist_Mono,
  Space_Mono,
  VT323,
  Plus_Jakarta_Sans,
  Inter_Tight,
  Archivo,
  Outfit,
  Albert_Sans,
  Caveat,
  Architects_Daughter,
  Patrick_Hand,
  Shadows_Into_Light,
  Kalam,
  Space_Grotesk,
  Bricolage_Grotesque,
  Bagel_Fat_One,
  DM_Serif_Display,
} from 'next/font/google';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter', weight: ['400', '500', '600', '700'] });
const geist = Geist({ subsets: ['latin'], display: 'swap', variable: '--font-geist', weight: ['400', '500', '600', '700'] });
const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope', weight: ['400', '600', '700'] });
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], display: 'swap', variable: '--font-instrument-serif', weight: ['400'] });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains-mono', weight: ['400', '500', '700'] });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-ibm-plex-mono', weight: ['400', '500', '700'] });
const geistMono = Geist_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-geist-mono', weight: ['400', '500', '700'] });
const spaceMono = Space_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-space-mono', weight: ['400', '700'] });
const vt323 = VT323({ subsets: ['latin'], display: 'swap', variable: '--font-vt323', weight: ['400'] });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-plus-jakarta-sans', weight: ['400', '600', '700'] });
const interTight = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--font-inter-tight', weight: ['400', '600', '700'] });
const archivo = Archivo({ subsets: ['latin'], display: 'swap', variable: '--font-archivo', weight: ['400', '600', '700'] });
const outfit = Outfit({ subsets: ['latin'], display: 'swap', variable: '--font-outfit', weight: ['400', '600', '700'] });
const albertSans = Albert_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-albert-sans', weight: ['400', '600', '700'] });
const caveat = Caveat({ subsets: ['latin'], display: 'swap', variable: '--font-caveat', weight: ['400', '600', '700'] });
const architectsDaughter = Architects_Daughter({ subsets: ['latin'], display: 'swap', variable: '--font-architects-daughter', weight: ['400'] });
const patrickHand = Patrick_Hand({ subsets: ['latin'], display: 'swap', variable: '--font-patrick-hand', weight: ['400'] });
const shadowsIntoLight = Shadows_Into_Light({ subsets: ['latin'], display: 'swap', variable: '--font-shadows-into-light', weight: ['400'] });
const kalam = Kalam({ subsets: ['latin'], display: 'swap', variable: '--font-kalam', weight: ['400', '700'] });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-space-grotesk', weight: ['400', '600', '700'] });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-bricolage-grotesque', weight: ['400', '600', '700'] });
const bagel = Bagel_Fat_One({ subsets: ['latin'], display: 'swap', variable: '--font-bagel-fat-one', weight: ['400'] });
const dmSerifDisplay = DM_Serif_Display({ subsets: ['latin'], display: 'swap', variable: '--font-dm-serif-display', weight: ['400'] });

const FONT_VARIABLES = [
  inter.variable,
  geist.variable,
  manrope.variable,
  instrumentSerif.variable,
  jetbrainsMono.variable,
  ibmPlexMono.variable,
  geistMono.variable,
  spaceMono.variable,
  vt323.variable,
  plusJakarta.variable,
  interTight.variable,
  archivo.variable,
  outfit.variable,
  albertSans.variable,
  caveat.variable,
  architectsDaughter.variable,
  patrickHand.variable,
  shadowsIntoLight.variable,
  kalam.variable,
  spaceGrotesk.variable,
  bricolage.variable,
  bagel.variable,
  dmSerifDisplay.variable,
].join(' ');

export default function CanvasLayout({ children }: { children: ReactNode }) {
  return <div className={FONT_VARIABLES}>{children}</div>;
}
