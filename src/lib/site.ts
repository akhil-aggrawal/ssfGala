export const site = {
  name: "Small Steps Foundation Gala",
  tagline: "An Evening That Moves You",
} as const;

export function placeholderHeading(): string {
  return `${site.name}: ${site.tagline}`;
}
