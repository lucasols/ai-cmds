interface TreeNode {
  children: Map<string, TreeNode>;
  isFile: boolean;
}

interface CollapsedInfo {
  fileCount: number;
  dirCount: number;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { children: new Map(), isFile: false };

  for (const file of files) {
    const parts = file.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (!part) continue;

      if (!current.children.has(part)) {
        current.children.set(part, {
          children: new Map(),
          isFile: i === parts.length - 1,
        });
      }

      current = current.children.get(part)!;
    }
  }

  return root;
}

function collapseSingleChildDirs(node: TreeNode): TreeNode {
  const collapsed: TreeNode = {
    children: new Map(),
    isFile: node.isFile,
  };

  for (const [name, child] of node.children) {
    const collapsedChild = collapseSingleChildDirs(child);

    if (
      !collapsedChild.isFile &&
      collapsedChild.children.size === 1
    ) {
      const [childName, grandChild] = [...collapsedChild.children.entries()][0];
      collapsed.children.set(`${name}/${childName}`, grandChild);
    } else {
      collapsed.children.set(name, collapsedChild);
    }
  }

  return collapsed;
}

function renderTree(node: TreeNode, prefix: string): string[] {
  const lines: string[] = [];
  const entries = [...node.children.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [name, child] = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const continuation = isLast ? '    ' : '│   ';

    const displayName =
      child.isFile || child.children.size === 0 ? name : `${name}/`;

    lines.push(`${prefix}${connector}${displayName}`);

    if (child.children.size > 0) {
      lines.push(...renderTree(child, `${prefix}${continuation}`));
    }
  }

  return lines;
}

function getMaxDepth(node: TreeNode, current: number): number {
  if (node.children.size === 0) return current;

  let max = current;
  for (const child of node.children.values()) {
    max = Math.max(max, getMaxDepth(child, current + 1));
  }
  return max;
}

function countContents(node: TreeNode): CollapsedInfo {
  let fileCount = 0;
  let dirCount = 0;

  for (const child of node.children.values()) {
    if (child.isFile && child.children.size === 0) {
      fileCount++;
    } else {
      dirCount++;
      const sub = countContents(child);
      fileCount += sub.fileCount;
      dirCount += sub.dirCount;
    }
  }

  return { fileCount, dirCount };
}

function formatCollapsedLabel(info: CollapsedInfo): string {
  const parts: string[] = [];
  if (info.dirCount > 0) {
    parts.push(`${info.dirCount} ${info.dirCount === 1 ? 'dir' : 'dirs'}`);
  }
  if (info.fileCount > 0) {
    parts.push(
      `${info.fileCount} ${info.fileCount === 1 ? 'file' : 'files'}`,
    );
  }
  return `(${parts.join(', ')})`;
}

function collapseAtDepth(
  node: TreeNode,
  targetDepth: number,
  currentDepth: number,
): TreeNode {
  if (currentDepth >= targetDepth && node.children.size > 0 && !node.isFile) {
    const info = countContents(node);
    const label = formatCollapsedLabel(info);

    const summaryNode: TreeNode = {
      children: new Map(),
      isFile: true,
    };

    const collapsed: TreeNode = {
      children: new Map([[label, summaryNode]]),
      isFile: false,
    };

    return collapsed;
  }

  const result: TreeNode = {
    children: new Map(),
    isFile: node.isFile,
  };

  for (const [name, child] of node.children) {
    result.children.set(
      name,
      collapseAtDepth(child, targetDepth, currentDepth + 1),
    );
  }

  return result;
}

export function formatFileTree(files: string[], maxLines: number): string[] {
  if (files.length === 0) return [];

  const rawTree = buildTree(files);
  let tree = collapseSingleChildDirs(rawTree);

  let lines = renderTree(tree, '');

  if (lines.length <= maxLines) {
    return lines;
  }

  let depth = getMaxDepth(tree, 0);

  while (lines.length > maxLines && depth > 1) {
    depth--;
    tree = collapseAtDepth(collapseSingleChildDirs(rawTree), depth, 0);
    lines = renderTree(tree, '');
  }

  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    const remaining = files.length - truncated.length;
    if (remaining > 0) {
      truncated.push(`... and ${remaining} more files`);
    }
    return truncated;
  }

  return lines;
}
