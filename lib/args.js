// 命令行参数解析（纯函数，便于单测）。
// kebab-case 选项会被转成驼峰：--no-browser 解析为 opts.noBrowser，
// 与代码里读取的 opts.noBrowser 保持一致（历史上这里出过 bug：
// --no-browser 被存成 opts['no-browser']，导致该选项永远不生效）。
export function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  return { opts, rest };
}
