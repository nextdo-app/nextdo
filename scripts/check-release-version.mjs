#!/usr/bin/env node
/**
 * 校验跨端与跨工作区版本号一致性，并防止测试版误打正式版 Tag（Issue #14 防护机制）。
 *
 * 检查的文件：
 * 1. package.json
 * 2. apps/mobile/package.json
 * 3. apps/mobile/app.json (expo.version)
 * 4. apps/desktop/package.json
 * 5. apps/desktop/src-tauri/Cargo.toml (package.version)
 * 6. apps/desktop/src-tauri/tauri.conf.json (version)
 *
 * 用法：
 *   node scripts/check-release-version.mjs
 *   node scripts/check-release-version.mjs --tag v0.1.5-beta.3
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function readJson(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function readCargoVersion(relPath) {
  const fullPath = path.join(ROOT, relPath);
  const content = fs.readFileSync(fullPath, 'utf8');
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match || !match[1]) {
    throw new Error(`Failed to parse version from Cargo.toml at ${relPath}`);
  }
  return match[1];
}

// 收集所有版本号
const versionSources = [
  { file: 'package.json', version: readJson('package.json').version },
  { file: 'apps/mobile/package.json', version: readJson('apps/mobile/package.json').version },
  { file: 'apps/mobile/app.json', version: readJson('apps/mobile/app.json').expo?.version },
  { file: 'apps/desktop/package.json', version: readJson('apps/desktop/package.json').version },
  { file: 'apps/desktop/src-tauri/Cargo.toml', version: readCargoVersion('apps/desktop/src-tauri/Cargo.toml') },
  { file: 'apps/desktop/src-tauri/tauri.conf.json', version: readJson('apps/desktop/src-tauri/tauri.conf.json').version },
];

const baseVersion = versionSources[0].version;
if (!baseVersion) {
  console.error('❌ Root package.json does not specify a valid version.');
  process.exit(1);
}

// 检查版本号一致性
const mismatches = versionSources.filter((s) => s.version !== baseVersion);
if (mismatches.length > 0) {
  console.error(`❌ Version mismatch detected! Expected base version: ${baseVersion}`);
  for (const source of versionSources) {
    console.error(`   - ${source.file}: ${source.version}`);
  }
  process.exit(1);
}

// 解析版本渠道
const isPrerelease = baseVersion.includes('-');
const channel = isPrerelease
  ? baseVersion.split('-')[1]?.split('.')[0] || 'prerelease'
  : 'stable';

console.log(`✅ Version consistency check passed across all ${versionSources.length} files:`);
console.log(`   - Version: ${baseVersion}`);
console.log(`   - Channel: ${channel} (${isPrerelease ? 'Prerelease/Beta' : 'Stable'})`);

// 若指定了 --tag 参数，做进一步 Tag 匹配与正式版防误发检查
const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
if (tagIndex !== -1 && args[tagIndex + 1]) {
  const tag = args[tagIndex + 1].trim();
  console.log(`\n🔍 Verifying git tag: "${tag}"...`);

  if (!tag.startsWith('v')) {
    console.error(`❌ Release tag must start with "v" (e.g. v${baseVersion}), got: "${tag}"`);
    process.exit(1);
  }

  const tagVersion = tag.slice(1);
  if (tagVersion !== baseVersion) {
    console.error(`❌ Tag version mismatch! Tag is "${tag}" (version: ${tagVersion}), but project files are at "${baseVersion}".`);
    process.exit(1);
  }

  const tagIsPrerelease = tag.includes('-');

  // 核心规则：测试版不得使用正式版 tag 发布；正式版也不得使用测试版 tag
  if (!tagIsPrerelease && isPrerelease) {
    console.error(`❌ [CRITICAL SAFETY CHECK FAILED - Issue #14]`);
    console.error(`   Attempted to release prerelease code (${baseVersion}) with a stable tag (${tag})!`);
    console.error(`   Prereleases MUST use prerelease tags like "v${baseVersion}".`);
    process.exit(1);
  }

  if (tagIsPrerelease && !isPrerelease) {
    console.error(`❌ [CRITICAL SAFETY CHECK FAILED - Issue #14]`);
    console.error(`   Attempted to use prerelease tag (${tag}) for stable release code (${baseVersion})!`);
    process.exit(1);
  }

  console.log(`✅ Tag "${tag}" matches project version "${baseVersion}" and channel "${channel}".`);
}

// 在 GitHub Actions 环境中输出便利变量
if (process.env.GITHUB_OUTPUT) {
  const output = [
    `version=${baseVersion}`,
    `channel=${channel}`,
    `is_prerelease=${isPrerelease}`,
  ].join('\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n', 'utf8');
}
