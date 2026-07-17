import type { Project, UserProfile } from "./types";

// Movement flow helpers — the loop is defined per project:
//   primaryLocation → stage 1 → stage 2 → … → back to primaryLocation
// A stage can hold several alternative locations (1.a, 1.b, 1.c…). When it
// does, the user chooses which one at check-out.

/** The user's project: first active project whose name is in their profile. */
export function findUserProject(profile: Pick<UserProfile, "projects"> | null | undefined, projects: Project[]): Project | undefined {
  const names = profile?.projects ?? [];
  return projects.find((p) => names.includes(p.name));
}

/**
 * The loop as ordered stages: [[primary], [stage-1 alternatives], [stage-2 …], …].
 * Falls back to the legacy `receivingLocations` (one location per stage).
 * Empty if the project has no flow configured.
 */
export function projectStages(project: Project | undefined): string[][] {
  if (!project?.primaryLocation) return [];
  const stages: string[][] = project.receivingStages?.length
    ? project.receivingStages.map((s) => s.filter(Boolean))
    : (project.receivingLocations ?? []).map((l) => [l]);
  return [[project.primaryLocation], ...stages.filter((s) => s.length > 0)];
}

/** Flat list of every location in the loop (used for display/labels). */
export function projectFlow(project: Project | undefined): string[] {
  return projectStages(project).flat();
}

/**
 * Allowed check-out destinations from `fromLoc`: every alternative on the NEXT
 * stage of the loop (wrapping back to primary at the end). More than one means
 * the user must choose. Empty array = no flow configured → unrestricted.
 */
export function nextInFlow(project: Project | undefined, fromLoc: string): string[] {
  const stages = projectStages(project);
  if (stages.length < 2) return [];
  const idx = stages.findIndex((s) => s.includes(fromLoc));
  if (idx === -1) return [];
  return stages[(idx + 1) % stages.length];
}
