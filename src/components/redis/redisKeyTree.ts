import type { TreeNode } from './KeyTreeItem.vue'

const SEPARATOR = ':'

export interface RedisKeyTreeBuildOptions {
  previousTree?: TreeNode[]
}

function collectExpanded(nodes: TreeNode[], expanded: Set<string>): void {
  for (const node of nodes) {
    if (!node.isLeaf && node.expanded) expanded.add(node.fullKey)
    collectExpanded(node.children, expanded)
  }
}

function collapseSinglePath(nodes: TreeNode[]): TreeNode[] {
  return nodes.map(node => {
    if (!node.isLeaf && node.children.length === 1 && !node.children[0]!.isLeaf) {
      const child = node.children[0]!
      return {
        ...node,
        name: `${node.name}${SEPARATOR}${child.name}`,
        fullKey: child.fullKey,
        expanded: node.expanded || child.expanded,
        children: collapseSinglePath(child.children),
      }
    }
    if (!node.isLeaf) node.children = collapseSinglePath(node.children)
    return node
  })
}

export function buildRedisKeyTree(keys: string[], options: RedisKeyTreeBuildOptions = {}): TreeNode[] {
  const expanded = new Set<string>()
  if (options.previousTree) collectExpanded(options.previousTree, expanded)

  const root: TreeNode[] = []
  const sorted = [...new Set(keys)].sort()

  for (const key of sorted) {
    const parts = key.split(SEPARATOR)
    let current = root

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!
      const isLast = index === parts.length - 1
      const fullKey = parts.slice(0, index + 1).join(SEPARATOR)

      let node = current.find(item => item.name === part && item.isLeaf === isLast)
      if (!node) {
        node = {
          name: part,
          fullKey: isLast ? key : fullKey,
          isLeaf: isLast,
          children: [],
          expanded: expanded.has(fullKey),
        }
        current.push(node)
      }
      current = node.children
    }
  }

  return collapseSinglePath(root)
}

export function removeRedisKeys(keys: string[], deleted: Iterable<string>): string[] {
  const deletedSet = new Set(deleted)
  return keys.filter(key => !deletedSet.has(key))
}
