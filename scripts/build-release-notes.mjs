#!/usr/bin/env node
/**
 * 生成 GitHub Release 的说明正文（= 应用内「更新说明 (ChangeLog)」显示的内容）。
 *
 * 应用侧的 ChangeLog 直接读 release 正文：`releases.atom` 的 <content> 就是
 * release body 本身（见 apps/mobile/lib/app-update.ts 的 parseAtomFeedEntries）。
 * 所以正文必须是给人看的变更日志 —— 换成安装包文件名清单，用户在应用里看到的
 * 就是一串 .dmg/.apk（v0.1.6-beta.4 那次就是这样）。
 *
 * 本脚本按 git 提交历史生成正文：
 *   1. `git describe --tags --abbrev=0 --match 'v*' <tag>^` 找上一个版本 tag；
 *   2. 取两个 tag 之间的非 merge 提交标题，按 conventional-commit 前缀分节；
 *   3. 丢掉对用户没有信息量的噪音提交（journal 记录、版本号 bump）。
 * 因此 CI 里 checkout 必须 fetch-depth: 0 —— 浅克隆既没有历史，也没有旧 tag。
 *
 * 用法：
 *   node scripts/build-release-notes.mjs --tag v0.1.6-beta.4 --output notes.md
 *
 * 兜底原则：git 任何一步失败都不让发布挂掉，退回一行说明；但绝不退回产物清单。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/** conventional-commit 类型 → 正文小节标题。 */
const SECTION_BY_TYPE = {
  feat: '✨ 新功能',
  fix: '🐛 问题修复',
  perf: '⚡ 性能优化',
  refactor: '♻️ 优化与重构',
  revert: '⏪ 回退',
  docs: '📝 文档',
  build: '🔧 其他改动',
  chore: '🔧 其他改动',
  ci: '🔧 其他改动',
  test: '🔧 其他改动',
  style: '🔧 其他改动',
};

/** 正文里小节的顺序（越靠前越可能是用户关心的）。 */
const SECTION_ORDER = [
  '✨ 新功能',
  '🐛 问题修复',
  '⚡ 性能优化',
  '♻️ 优化与重构',
  '⏪ 回退',
  '📝 文档',
  '🔧 其他改动',
];

const FALLBACK_SECTION = '🔧 其他改动';

/** 纯流程提交：对用户没有信息量，不进 ChangeLog。 */
const NOISE_PATTERNS = [/^chore:\s*record journal\b/i, /^chore\(release\):\s*bump version\b/i];

/** conventional-commit 前缀：`type(scope)!: 描述`。 */
const CONVENTIONAL_PATTERN = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/;

/** 提交属于哪一小节；认不出的前缀落到「其他改动」。 */
function sectionForType(type) {
  if (type === undefined) return FALLBACK_SECTION;
  return SECTION_BY_TYPE[type] ?? FALLBACK_SECTION;
}

/** 跑一条 git 命令，返回 stdout（失败抛异常，由调用方兜底）。 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** 解析 `--key value` 形式的参数。 */
function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const value = argv[i + 1];
    if (typeof value === 'string') {
      parsed[token.slice(2)] = value;
      i += 1;
    }
  }
  return parsed;
}

/** 该引用能否解析成一个提交（tag 没 fetch 到 / 写错时失败）。 */
function resolves(revision) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** 上一个版本 tag；首个版本或取不到时返回 null。 */
function previousTag(end) {
  try {
    const found = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', `${end}^`]);
    return found === '' || found === end ? null : found;
  } catch {
    return null;
  }
}

/** 两个 tag 之间的非 merge 提交标题（旧 → 新，去重）。 */
function commitSubjects(prevTag, end) {
  const range = prevTag === null ? end : `${prevTag}..${end}`;
  const raw = git(['log', '--no-merges', '--reverse', '--pretty=format:%s', range]);
  const subjects = [];
  const seen = new Set();
  for (const line of raw.split('\n')) {
    const subject = line.trim();
    if (subject === '' || seen.has(subject)) continue;
    seen.add(subject);
    subjects.push(subject);
  }
  return subjects;
}

/** 该提交标题是否属于纯流程噪音。 */
function isNoise(subject) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(subject));
}

/** 从 origin 地址里取 `owner/name`；拿不到返回 null（正文就不放对比链接）。 */
function repoFromRemote() {
  try {
    const remote = git(['remote', 'get-url', 'origin']);
    const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    return match === null ? null : `${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}

/** 组装正文：`## 标题` + 分节列表 + 对比链接。 */
function buildNotes({ tag, prevTag, repo, subjects }) {
  const lines = [`## What's Changed in Nextdo ${tag}`, ''];

  /** 小节标题 → 条目（conventional 前缀已剥掉，只留描述）。 */
  const sections = new Map(SECTION_ORDER.map((title) => [title, []]));
  for (const subject of subjects) {
    const match = CONVENTIONAL_PATTERN.exec(subject);
    const text = (match?.[3] ?? subject).trim();
    sections.get(sectionForType(match?.[1])).push(text);
  }

  let wroteSection = false;
  for (const title of SECTION_ORDER) {
    const items = sections.get(title);
    if (items.length === 0) continue;
    lines.push(`### ${title}`, '', ...items.map((item) => `- ${item}`), '');
    wroteSection = true;
  }
  if (!wroteSection) {
    lines.push('- 常规维护与改进。', '');
  }
  if (prevTag !== null && repo !== null) {
    lines.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${tag}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tag = (args.tag ?? '').trim();
  if (tag === '') {
    console.error('用法：node scripts/build-release-notes.mjs --tag <vX.Y.Z> [--repo owner/name] [--output <file>]');
    process.exit(1);
  }
  // tag 解析不了（本地没有这个 tag）就退到 HEAD —— workflow 里 tag 指的就是 HEAD。
  const end = resolves(tag) ? tag : 'HEAD';
  let notes;
  try {
    const prevTag = previousTag(end);
    const subjects = commitSubjects(prevTag, end).filter((subject) => !isNoise(subject));
    notes = buildNotes({ tag, prevTag, repo: args.repo ?? repoFromRemote(), subjects });
  } catch (error) {
    // 兜底：不让发布因为生成说明而挂掉，但也绝不退回产物清单。
    console.error(`⚠️ 生成 release 说明失败，退回最简说明：${error.message}`);
    notes = `## What's Changed in Nextdo ${tag}\n\n- 常规维护与改进。\n`;
  }

  if (typeof args.output === 'string' && args.output !== '') {
    fs.writeFileSync(args.output, notes, 'utf8');
    console.error(`已写入 ${args.output}`);
  } else {
    process.stdout.write(notes);
  }
}

main();
