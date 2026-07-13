import type { Project, UserProfile } from "./types";

// Movement flow helpers — the loop is defined per project:
// primaryLocation → receivingLocations[0] → [1] → … → back to primaryLocation

/** The user's project: first active project whose name is in their profile. */
export function findUserProject(profile: Pick<UserProfile, "projects"> | null | undefined, projects: Project[]): Project | undefined {
  const names = profile?.projects ?? [];
  return projects.find((p) => names.includes(p.name));
}

/** Ordered loop for a project: [primary, receiving1, receiving2, …]. Empty if not configured. */
export function projectFlow(project: Project | undefined): string[] {
  if (!project?.primaryLocation) return [];
  return [project.primaryLocation, ...(project.receivingLocations ?? [])];
}

/**
 * Allowed checkout destinations from `fromLoc` per the project loop:
 * the next stop in the flow (wrapping back to primary at the end).
 * Empty array = no flow configured → unrestricted.
 */
export function nextInFlow(project: Project | undefined, fromLoc: string): string[] {
  const flow = projectFlow(project);
  if (flow.length < 2) return [];
  const idx = flow.indexOf(fromLoc);
  if (idx === -1) return [];
  return [flow[(idx + 1) % flow.length]];
}
