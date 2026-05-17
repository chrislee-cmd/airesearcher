// Deterministic project → color mapping for the scheduler canvas. The
// mapping is index-based off the project list order so a project keeps the
// same color across renders within a session. Eight tokens are enough for
// most orgs; collisions are tolerable because we always show the project
// name next to the color.

export type ProjectColor = {
  // Tailwind-friendly background (10–15% alpha overlay)
  bg: string;
  // Solid border / dot color
  border: string;
  // Inline color string (used for SVG/inline markup if needed)
  hex: string;
};

const PALETTE: ProjectColor[] = [
  { bg: 'bg-[#0EA5E9]/15', border: 'border-[#0EA5E9]', hex: '#0EA5E9' },
  { bg: 'bg-[#F97316]/15', border: 'border-[#F97316]', hex: '#F97316' },
  { bg: 'bg-[#10B981]/15', border: 'border-[#10B981]', hex: '#10B981' },
  { bg: 'bg-[#A855F7]/15', border: 'border-[#A855F7]', hex: '#A855F7' },
  { bg: 'bg-[#F43F5E]/15', border: 'border-[#F43F5E]', hex: '#F43F5E' },
  { bg: 'bg-[#EAB308]/15', border: 'border-[#EAB308]', hex: '#EAB308' },
  { bg: 'bg-[#06B6D4]/15', border: 'border-[#06B6D4]', hex: '#06B6D4' },
  { bg: 'bg-[#84CC16]/15', border: 'border-[#84CC16]', hex: '#84CC16' },
];

export const NONE_COLOR: ProjectColor = {
  bg: 'bg-mute/10',
  border: 'border-mute',
  hex: '#9CA3AF',
};

export function colorForProject(
  projectId: string | null,
  projectsInOrder: { id: string }[],
): ProjectColor {
  if (!projectId) return NONE_COLOR;
  const idx = projectsInOrder.findIndex((p) => p.id === projectId);
  if (idx < 0) return NONE_COLOR;
  return PALETTE[idx % PALETTE.length];
}
