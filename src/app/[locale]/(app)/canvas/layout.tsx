/* ────────────────────────────────────────────────────────────────────
   Canvas route layout — next/font/google 로 theme × font variant preload.
   variable mode → canvas-board 가 inline style 로 활성 폰트 주입.

   ⚠️ next/font/google loader 는 인자 inline literal 필요 (spread 금지).
   모든 옵션 매 호출마다 직접 작성.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import {
  Inter, Geist, Manrope, Instrument_Serif,
  JetBrains_Mono, IBM_Plex_Mono, Geist_Mono, Space_Mono, VT323,
  Plus_Jakarta_Sans, Inter_Tight, Archivo, Outfit, Albert_Sans,
  Caveat, Architects_Daughter, Patrick_Hand, Shadows_Into_Light, Kalam,
  Space_Grotesk, Bricolage_Grotesque, Bagel_Fat_One, DM_Serif_Display,
  // === 2026-06-25 +30: 6 dimension 각 10 옵션 확장 ===
  DM_Sans, Lexend, Sora, Public_Sans, Work_Sans,
  Fira_Code, Roboto_Mono, Source_Code_Pro, Cutive_Mono, Share_Tech_Mono,
  Be_Vietnam_Pro, Nunito,
  Roboto, IBM_Plex_Sans,
  Indie_Flower, Reenie_Beanie, Gloria_Hallelujah, Just_Another_Hand, Pangolin,
  Fredoka, Lilita_One, Bowlby_One, Modak, Boogaloo,
  Cormorant_Garamond, Playfair_Display, Fraunces, EB_Garamond, Cinzel, Italiana,
  Spectral, Crimson_Pro, DM_Serif_Text,
  Orbitron, Audiowide, Bungee, Major_Mono_Display, Wallpoet, Press_Start_2P,
  Monoton, Rubik_Mono_One,
  Special_Elite, Antic_Didone, Fjalla_One, Anton, Oswald,
  Cabin_Sketch, Codystar, Amatic_SC, UnifrakturCook, Stardos_Stencil,
  Anonymous_Pro, Inconsolata,
  Quicksand, Comfortaa, Varela_Round, M_PLUS_Rounded_1c, Karla, Baloo_2,
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

// === 2026-06-25 +30 new fonts ===
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans', weight: ['400', '500', '700'] });
const lexend = Lexend({ subsets: ['latin'], display: 'swap', variable: '--font-lexend', weight: ['400', '600', '700'] });
const sora = Sora({ subsets: ['latin'], display: 'swap', variable: '--font-sora', weight: ['400', '600', '700'] });
const publicSans = Public_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-public-sans', weight: ['400', '600', '700'] });
const workSans = Work_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-work-sans', weight: ['400', '600', '700'] });
const firaCode = Fira_Code({ subsets: ['latin'], display: 'swap', variable: '--font-fira-code', weight: ['400', '500', '700'] });
const robotoMono = Roboto_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-roboto-mono', weight: ['400', '500', '700'] });
const sourceCodePro = Source_Code_Pro({ subsets: ['latin'], display: 'swap', variable: '--font-source-code-pro', weight: ['400', '600', '700'] });
const cutiveMono = Cutive_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-cutive-mono', weight: ['400'] });
const shareTechMono = Share_Tech_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-share-tech-mono', weight: ['400'] });
const beVietnamPro = Be_Vietnam_Pro({ subsets: ['latin'], display: 'swap', variable: '--font-be-vietnam-pro', weight: ['400', '600', '700'] });
const nunito = Nunito({ subsets: ['latin'], display: 'swap', variable: '--font-nunito', weight: ['400', '600', '700'] });
const roboto = Roboto({ subsets: ['latin'], display: 'swap', variable: '--font-roboto', weight: ['400', '500', '700'] });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-ibm-plex-sans', weight: ['400', '600', '700'] });
const indieFlower = Indie_Flower({ subsets: ['latin'], display: 'swap', variable: '--font-indie-flower', weight: ['400'] });
const reenieBeanie = Reenie_Beanie({ subsets: ['latin'], display: 'swap', variable: '--font-reenie-beanie', weight: ['400'] });
const gloriaHallelujah = Gloria_Hallelujah({ subsets: ['latin'], display: 'swap', variable: '--font-gloria-hallelujah', weight: ['400'] });
const justAnotherHand = Just_Another_Hand({ subsets: ['latin'], display: 'swap', variable: '--font-just-another-hand', weight: ['400'] });
const pangolin = Pangolin({ subsets: ['latin'], display: 'swap', variable: '--font-pangolin', weight: ['400'] });
const fredoka = Fredoka({ subsets: ['latin'], display: 'swap', variable: '--font-fredoka', weight: ['400', '600', '700'] });
const lilitaOne = Lilita_One({ subsets: ['latin'], display: 'swap', variable: '--font-lilita-one', weight: ['400'] });
const bowlbyOne = Bowlby_One({ subsets: ['latin'], display: 'swap', variable: '--font-bowlby-one', weight: ['400'] });
const modak = Modak({ subsets: ['latin'], display: 'swap', variable: '--font-modak', weight: ['400'] });
const boogaloo = Boogaloo({ subsets: ['latin'], display: 'swap', variable: '--font-boogaloo', weight: ['400'] });
const cormorantGaramond = Cormorant_Garamond({ subsets: ['latin'], display: 'swap', variable: '--font-cormorant-garamond', weight: ['400', '600', '700'] });
const playfairDisplay = Playfair_Display({ subsets: ['latin'], display: 'swap', variable: '--font-playfair-display', weight: ['400', '700'] });
const fraunces = Fraunces({ subsets: ['latin'], display: 'swap', variable: '--font-fraunces', weight: ['400', '600', '700'] });
const ebGaramond = EB_Garamond({ subsets: ['latin'], display: 'swap', variable: '--font-eb-garamond', weight: ['400', '700'] });
const cinzel = Cinzel({ subsets: ['latin'], display: 'swap', variable: '--font-cinzel', weight: ['400', '700'] });
const italiana = Italiana({ subsets: ['latin'], display: 'swap', variable: '--font-italiana', weight: ['400'] });
const spectral = Spectral({ subsets: ['latin'], display: 'swap', variable: '--font-spectral', weight: ['400', '700'] });
const crimsonPro = Crimson_Pro({ subsets: ['latin'], display: 'swap', variable: '--font-crimson-pro', weight: ['400', '700'] });
const dmSerifText = DM_Serif_Text({ subsets: ['latin'], display: 'swap', variable: '--font-dm-serif-text', weight: ['400'] });
const orbitron = Orbitron({ subsets: ['latin'], display: 'swap', variable: '--font-orbitron', weight: ['400', '700'] });
const audiowide = Audiowide({ subsets: ['latin'], display: 'swap', variable: '--font-audiowide', weight: ['400'] });
const bungee = Bungee({ subsets: ['latin'], display: 'swap', variable: '--font-bungee', weight: ['400'] });
const majorMono = Major_Mono_Display({ subsets: ['latin'], display: 'swap', variable: '--font-major-mono-display', weight: ['400'] });
const wallpoet = Wallpoet({ subsets: ['latin'], display: 'swap', variable: '--font-wallpoet', weight: ['400'] });
const pressStart2p = Press_Start_2P({ subsets: ['latin'], display: 'swap', variable: '--font-press-start-2p', weight: ['400'] });
const monoton = Monoton({ subsets: ['latin'], display: 'swap', variable: '--font-monoton', weight: ['400'] });
const rubikMonoOne = Rubik_Mono_One({ subsets: ['latin'], display: 'swap', variable: '--font-rubik-mono-one', weight: ['400'] });
const specialElite = Special_Elite({ subsets: ['latin'], display: 'swap', variable: '--font-special-elite', weight: ['400'] });
const anticDidone = Antic_Didone({ subsets: ['latin'], display: 'swap', variable: '--font-antic-didone', weight: ['400'] });
const fjallaOne = Fjalla_One({ subsets: ['latin'], display: 'swap', variable: '--font-fjalla-one', weight: ['400'] });
const anton = Anton({ subsets: ['latin'], display: 'swap', variable: '--font-anton', weight: ['400'] });
const oswald = Oswald({ subsets: ['latin'], display: 'swap', variable: '--font-big-shoulders-display', weight: ['400', '700'] });
const cabinSketch = Cabin_Sketch({ subsets: ['latin'], display: 'swap', variable: '--font-cabin-sketch', weight: ['400', '700'] });
const codystar = Codystar({ subsets: ['latin'], display: 'swap', variable: '--font-codystar', weight: ['400'] });
const amaticSc = Amatic_SC({ subsets: ['latin'], display: 'swap', variable: '--font-amatic-sc', weight: ['400', '700'] });
const unifrakturCook = UnifrakturCook({ subsets: ['latin'], display: 'swap', variable: '--font-unifrakturcook', weight: ['700'] });
const stardosStencil = Stardos_Stencil({ subsets: ['latin'], display: 'swap', variable: '--font-workbench', weight: ['400', '700'] });
const anonymousPro = Anonymous_Pro({ subsets: ['latin'], display: 'swap', variable: '--font-anonymous-pro', weight: ['400', '700'] });
const inconsolata = Inconsolata({ subsets: ['latin'], display: 'swap', variable: '--font-inconsolata', weight: ['400', '600', '700'] });
const quicksand = Quicksand({ subsets: ['latin'], display: 'swap', variable: '--font-quicksand', weight: ['400', '600', '700'] });
const comfortaa = Comfortaa({ subsets: ['latin'], display: 'swap', variable: '--font-comfortaa', weight: ['400', '600', '700'] });
const varelaRound = Varela_Round({ subsets: ['latin'], display: 'swap', variable: '--font-varela-round', weight: ['400'] });
const mplusRounded = M_PLUS_Rounded_1c({ subsets: ['latin'], display: 'swap', variable: '--font-m-plus-rounded-1c', weight: ['400', '700'] });
const karla = Karla({ subsets: ['latin'], display: 'swap', variable: '--font-karla', weight: ['400', '600', '700'] });
const baloo2 = Baloo_2({ subsets: ['latin'], display: 'swap', variable: '--font-baloo-2', weight: ['400', '600', '700'] });

const FONT_VARIABLES = [
  inter.variable, geist.variable, manrope.variable, instrumentSerif.variable,
  jetbrainsMono.variable, ibmPlexMono.variable, geistMono.variable, spaceMono.variable, vt323.variable,
  plusJakarta.variable, interTight.variable, archivo.variable, outfit.variable, albertSans.variable,
  caveat.variable, architectsDaughter.variable, patrickHand.variable, shadowsIntoLight.variable, kalam.variable,
  spaceGrotesk.variable, bricolage.variable, bagel.variable, dmSerifDisplay.variable,
  dmSans.variable, lexend.variable, sora.variable, publicSans.variable, workSans.variable,
  firaCode.variable, robotoMono.variable, sourceCodePro.variable, cutiveMono.variable, shareTechMono.variable,
  beVietnamPro.variable, nunito.variable, roboto.variable, ibmPlexSans.variable,
  indieFlower.variable, reenieBeanie.variable, gloriaHallelujah.variable, justAnotherHand.variable, pangolin.variable,
  fredoka.variable, lilitaOne.variable, bowlbyOne.variable, modak.variable, boogaloo.variable,
  cormorantGaramond.variable, playfairDisplay.variable, fraunces.variable, ebGaramond.variable, cinzel.variable, italiana.variable,
  spectral.variable, crimsonPro.variable, dmSerifText.variable,
  orbitron.variable, audiowide.variable, bungee.variable, majorMono.variable, wallpoet.variable, pressStart2p.variable,
  monoton.variable, rubikMonoOne.variable,
  specialElite.variable, anticDidone.variable, fjallaOne.variable, anton.variable, oswald.variable,
  cabinSketch.variable, codystar.variable, amaticSc.variable, unifrakturCook.variable, stardosStencil.variable,
  anonymousPro.variable, inconsolata.variable,
  quicksand.variable, comfortaa.variable, varelaRound.variable, mplusRounded.variable, karla.variable, baloo2.variable,
].join(' ');

export default function CanvasLayout({ children }: { children: ReactNode }) {
  return <div className={FONT_VARIABLES}>{children}</div>;
}
