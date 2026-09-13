// glTF loaders strip "." from node names, so mesh names inside a GLB use "_" as separator.
export function meshKey(meshId: string) {
  return meshId.replaceAll(".", "_");
}
