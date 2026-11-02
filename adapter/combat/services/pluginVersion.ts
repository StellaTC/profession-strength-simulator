export function extractUserscriptVersion(source: string) {
  return source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m)?.[1]?.trim() || ""
}

function versionParts(version: string) {
  return String(version || "")
    .trim()
    .split(/[.+-]/)
    .map(part => Number.parseInt(part, 10))
    .map(part => Number.isFinite(part) ? part : 0)
}

export function comparePluginVersions(left: string, right: string) {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference) return difference > 0 ? 1 : -1
  }
  return 0
}
