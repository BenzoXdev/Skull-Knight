import type { BuildStream } from "./types";

const activeBuildStreams = new Map<string, BuildStream>();

export function addBuildStream(id: string, build: BuildStream): void {
  activeBuildStreams.set(id, build);
}

export function getBuildStream(id: string): BuildStream | undefined {
  return activeBuildStreams.get(id);
}

export function deleteBuildStream(id: string): boolean {
  const build = activeBuildStreams.get(id);
  if (build) {
    build.controllers.forEach((controller) => {
      try {
        controller.close();
      } catch {}
    });
    build.controllers.length = 0;
  }
  return activeBuildStreams.delete(id);
}

export function getAllBuildStreams(): Map<string, BuildStream> {
  return activeBuildStreams;
}

export function hasBuildStream(id: string): boolean {
  return activeBuildStreams.has(id);
}
