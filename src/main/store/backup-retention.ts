const TIMESTAMPED = /^state\.(corrupt|future|repaired)-(\d{1,16})\.json$/
const PRE_VERSION = /^state\.pre-v(\d{1,4})\.json$/

export const BACKUP_KEEP = { timestamped: 3, preVersion: 2 } as const

type Backup = { name: string; group: string; order: number }

function classify(name: string): Backup | null {
  const t = TIMESTAMPED.exec(name)
  if (t) return { name, group: t[1]!, order: Number(t[2]) }
  const v = PRE_VERSION.exec(name)
  return v ? { name, group: 'pre-v', order: Number(v[1]) } : null
}

/**
 * Which backup files to delete: all but the newest `timestamped` per kind (corrupt, future, repaired) and the
 * newest `preVersion` pre-migration copies. Only names matching the strict patterns are ever listed, so
 * state.json, its .bak, temp files and anything else in the folder are never touched.
 */
export function planBackupPrune(names: readonly string[], keep: { timestamped: number; preVersion: number } = BACKUP_KEEP): string[] {
  const backups = [...new Set(names)].flatMap((n) => classify(n) ?? [])
  const groups = [...new Set(backups.map((b) => b.group))]
  return groups.flatMap((group) => {
    const limit = group === 'pre-v' ? keep.preVersion : keep.timestamped
    return backups
      .filter((b) => b.group === group)
      .sort((a, b) => b.order - a.order)
      .slice(limit)
      .map((b) => b.name)
  })
}
