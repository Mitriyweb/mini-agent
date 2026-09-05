export interface WorkspaceState {
  root: string;
  realRoot: string;
  gitRoot: string | null;
}

export interface PathResolution {
  path: string;
  isFile: boolean;
  isDirectory: boolean;
}
