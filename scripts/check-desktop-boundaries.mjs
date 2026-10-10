import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const root = process.cwd()
const entries = [
  path.join(root, 'fronted/src/desktop/DesktopApp.tsx'),
  path.join(root, 'apps/realtime/src/room-v2.ts'),
  path.join(root, 'packages/shared/src/desktop.ts'),
]
const forbidden = [
  ['旧 App', 'fronted/src/App.tsx'],
  ['旧页面', 'fronted/src/pages/'],
  ['旧 store', 'fronted/src/store/'],
  ['旧实时客户端', 'fronted/src/lib/realtime.ts'],
  ['旧房间类型', 'fronted/src/types/index.ts'],
  ['HTML 解析', 'fronted/src/utils/gmPanelHtml.ts'],
  ['移动角色码', 'fronted/src/components/mobile-panel/'],
  ['移动角色码', 'packages/shared/src/mobile-panel-code.ts'],
  ['旧 Durable Object', 'apps/realtime/src/legacy-room.ts'],
  ['旧共享房间类型', 'packages/shared/src/types.ts'],
  ['旧共享协议', 'packages/shared/src/protocol.ts'],
  ['旧 HTML 工具', 'packages/shared/src/utils.ts'],
]
const obsoleteRoots = [
  'fronted/src/App.tsx', 'fronted/src/App.css', 'fronted/src/pages', 'fronted/src/store',
  'fronted/src/lib', 'fronted/src/components', 'fronted/src/types', 'fronted/src/utils',
  'fronted/src/preview', 'fronted/src/maintenance.css',
]

function normalized(file) { return path.relative(root, file).replaceAll('\\', '/') }
function loadConfig(file) {
  const config = ts.readConfigFile(file, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  return ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(file)).options
}
const configs = [
  [path.join(root, 'fronted'), loadConfig(path.join(root, 'fronted/tsconfig.app.json'))],
  [path.join(root, 'apps/realtime'), loadConfig(path.join(root, 'apps/realtime/tsconfig.json'))],
  [path.join(root, 'packages/shared'), { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, resolveJsonModule: true }],
]
const host = ts.createCompilerHost({})
function optionsFor(file) { return configs.find(([base]) => file.startsWith(base))?.[1] ?? configs[2][1] }
function resolve(specifier, containingFile) {
  const resolution = ts.resolveModuleName(specifier, containingFile, optionsFor(containingFile), host).resolvedModule
  if (!resolution || resolution.isExternalLibraryImport && resolution.packageId?.name !== '@dhgc/shared') return null
  const resolved = resolution.resolvedFileName.replace(/\.d\.ts$/, '.ts')
  return fs.existsSync(resolved) ? path.resolve(resolved) : null
}
function dependencies(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specs = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) specs.push(node.moduleReference.expression.text)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specs.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specs.flatMap(specifier => {
    const result = resolve(specifier, file)
    const extension = path.extname(specifier)
    const codeLike = !extension || ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'].includes(extension)
    if (!result && codeLike && (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('@dhgc/'))) throw new Error(`无法解析 ${normalized(file)} 中的模块：${specifier}`)
    return result ?? []
  })
}

function forbiddenMatch(file) {
  const relative = normalized(file)
  return forbidden.find(([, fragment]) => relative === fragment || relative.startsWith(fragment))
}
function dependencyGraph(startEntries) {
  const parents = new Map()
  const queue = [...startEntries]
  for (const entry of startEntries) parents.set(entry, null)
  while (queue.length) {
    const file = queue.shift()
    for (const dependency of dependencies(file)) {
      if (!parents.has(dependency)) {
        parents.set(dependency, file)
        if (!forbiddenMatch(dependency)) queue.push(dependency)
      }
    }
  }
  return parents
}

function boundaryFailures(parents) {
  const failures = []
  for (const file of parents.keys()) {
    const match = forbiddenMatch(file)
    if (!match) continue
    const chain = []
    for (let current = file; current; current = parents.get(current)) chain.unshift(normalized(current))
    failures.push(`${match[0]}：${chain.join(' -> ')}`)
  }
  return failures
}

const selfTest = process.argv.includes('--self-test')
const activeEntries = selfTest ? [path.join(root, 'scripts/fixtures/desktop-boundaries/entry.ts')] : entries
const parents = dependencyGraph(activeEntries)
const failures = boundaryFailures(parents)
if (selfTest) {
  const required = ['apps/realtime/src/legacy-room.ts', 'packages/shared/src/types.ts', 'packages/shared/src/protocol.ts', 'packages/shared/src/utils.ts']
  const output = failures.join('\n')
  if (required.every(fragment => output.includes(fragment))) console.log(`边界负向自检通过：\n${output}`)
  else { console.error(`边界负向自检未捕获全部禁区：\n${output}`); process.exitCode = 1 }
} else for (const relative of obsoleteRoots) {
  const target = path.join(root, relative)
  if (!fs.existsSync(target)) continue
  const stat = fs.statSync(target)
  if (stat.isFile() || fs.readdirSync(target, { recursive: true, withFileTypes: true }).some(entry => entry.isFile())) failures.push(`候选前端仍包含旧实现：${relative}`)
}
if (!selfTest && failures.length) {
  console.error(['Desktop V2 依赖边界检查失败：', ...failures.map(item => `- ${item}`)].join('\n'))
  process.exitCode = 1
} else if (!selfTest) {
  console.log(`Desktop V2 依赖边界检查通过（${parents.size} 个传递模块，TypeScript 解析别名与 barrel）。`)
}
