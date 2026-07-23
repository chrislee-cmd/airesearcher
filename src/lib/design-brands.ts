// Design brand registry — SSOT for the /design comparison grid and the
// /canvas?design=<brand> query-param toggle. Token blocks live in
// src/app/globals.css under `[data-design="<key>"]`; adding a brand here
// without a corresponding CSS block silently no-ops the wrapper.
//
// Source brand specs: ~/jarvis/design-system/DESIGN-<key>.md

export type DesignBrandSurface = 'light' | 'dark';

export type DesignBrand = {
  key: string;
  label: string;
  tagline: string;
  accent: string;
  surface: DesignBrandSurface;
};

export const DESIGN_BRANDS: readonly DesignBrand[] = [
  {
    key: 'bento',
    label: 'Bento (current)',
    tagline: 'Editorial cream canvas, single amore purple accent (#a06fda).',
    accent: '#a06fda',
    surface: 'light',
  },
  {
    key: 'airbnb',
    label: 'Airbnb',
    tagline: 'Marketplace, pure white canvas, single Rausch accent (#ff385c).',
    accent: '#ff385c',
    surface: 'light',
  },
  {
    key: 'apple',
    label: 'Apple',
    tagline: 'Museum gallery, white canvas, Action Blue (#0066cc) only.',
    accent: '#0066cc',
    surface: 'light',
  },
  {
    key: 'bmw-m',
    label: 'BMW M',
    tagline: 'Motorsport black canvas, white type, M tricolor as signature.',
    accent: '#1c69d4',
    surface: 'dark',
  },
  {
    key: 'claude',
    label: 'Claude',
    tagline: 'Cream canvas, serif headlines, coral CTA (#cc785c).',
    accent: '#cc785c',
    surface: 'light',
  },
  {
    key: 'cursor',
    label: 'Cursor',
    tagline: 'Warm cream IDE canvas, Cursor Orange (#f54e00) CTA.',
    accent: '#f54e00',
    surface: 'light',
  },
  {
    key: 'dell-1996',
    label: 'Dell (1996)',
    tagline: 'Catalog-era black frame, ribbon tints, Times body, zero radius.',
    accent: '#e91d2a',
    surface: 'light',
  },
  {
    key: 'elevenlabs',
    label: 'ElevenLabs',
    tagline: 'Off-white editorial, Waldenburg light display, near-black CTA.',
    accent: '#292524',
    surface: 'light',
  },
  {
    key: 'lamborghini',
    label: 'Lamborghini',
    tagline: 'Pure black canvas, Lamborghini Gold (#ffc000) only, zero radius.',
    accent: '#ffc000',
    surface: 'dark',
  },
  {
    key: 'meta',
    label: 'Meta',
    tagline: 'White canvas, pill buttons, Cobalt (#0064e0) buy CTA.',
    accent: '#0064e0',
    surface: 'light',
  },
  {
    key: 'nintendo-2001',
    label: 'Nintendo (2001)',
    tagline: 'Periwinkle metallic chrome, amber utilities, Y2K hardware.',
    accent: '#e60012',
    surface: 'light',
  },
  {
    key: 'notion',
    label: 'Notion',
    tagline: 'Paper-calm productivity, single confident blue (#0075de).',
    accent: '#0075de',
    surface: 'light',
  },
  {
    key: 'tesla',
    label: 'Tesla',
    tagline: 'White showroom canvas, single Electric Blue (#3E6AE1).',
    accent: '#3E6AE1',
    surface: 'light',
  },
] as const;

// Bento is the un-wrapped default; all other keys are valid `?design=<key>`
// overrides on /canvas.
export const DESIGN_BRAND_OVERRIDE_KEYS: ReadonlySet<string> = new Set(
  DESIGN_BRANDS.filter((b) => b.key !== 'bento').map((b) => b.key),
);
