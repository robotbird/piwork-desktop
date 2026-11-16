// 从 piwork web 仓库的模型供应商插件(plugins/piwork-llm-*)导出桌面端声明式目录。
//
// 用法: node scripts/export-model-catalog.mjs [piwork 仓库路径]
// 默认路径 ../piwork(与桌面仓库同级)。
//
// 桌面端不执行插件代码;此处仅在开发机上一劳永逸地提取声明式数据(definition + 模型目录),
// 生成的 JSON 签入仓库(electron/model-providers/catalog/)随应用分发。
// compat 标志与验证模型在插件 src/index.ts / provider.ts 内部常量中,无法程序化导出,
// 按供应商硬编码于下表(与插件源码保持一致,更新插件后需人工核对)。
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRepo = path.resolve(desktopRoot, '../piwork');
const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : defaultRepo;
const pluginsDir = path.join(repoRoot, 'plugins');
const outDir = path.join(desktopRoot, 'apps/desktop/electron/model-providers/catalog');

// 每家供应商的运行时兼容参数(对应插件 src/index.ts 的 toPiModel compat)与凭据验证模型
// (对应 provider.ts 的 VALIDATION_MODEL,仅用于 max_tokens=1 连通性探测)。
const providerExtras = {
  deepseek: {
    compat: { maxTokensField: 'max_tokens', thinkingFormat: 'deepseek' },
    validationModel: 'deepseek-v4-flash',
  },
  tongyi: {
    compat: {
      maxTokensField: 'max_tokens',
      thinkingFormat: 'qwen',
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
    },
    validationModel: 'qwen-turbo',
  },
  zhipuai: {
    compat: {
      maxTokensField: 'max_tokens',
      thinkingFormat: 'zai',
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
    },
    validationModel: 'glm-5-turbo',
  },
};

function pick(text, ...keys) {
  for (const key of keys) {
    const value = text?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

const dirs = (await readdir(pluginsDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith('piwork-llm-'))
  .map(entry => entry.name)
  .sort();

if (!dirs.length) {
  console.error(`No piwork-llm-* plugin packages found under ${pluginsDir}`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

for (const packageId of dirs) {
  const srcDir = path.join(pluginsDir, packageId, 'src');
  const providerKey = packageId.replace(/^piwork-llm-/, '');
  const extras = providerExtras[providerKey];
  if (!extras) {
    console.error(`No compat/validationModel table for "${providerKey}"; add it to providerExtras first.`);
    process.exit(1);
  }
  // Node ESM 无法解析插件里的扩展名省略导入("./models"),复制到临时目录并补 .ts 后缀后
  // 以类型剥离直接导入(SDK 依赖全部是 import type,剥离后无外部解析)。
  const stage = await mkdtemp(path.join(tmpdir(), 'piwork-catalog-'));
  try {
    const models = await readFile(path.join(srcDir, 'models.ts'), 'utf8');
    const provider = await readFile(path.join(srcDir, 'provider.ts'), 'utf8');
    await writeFile(path.join(stage, 'models.ts'), models);
    await writeFile(path.join(stage, 'provider.ts'), provider.replace(/(['"])\.\/models\1/g, '$1./models.ts$1'));
    const { definition } = await import(`file://${path.join(stage, 'provider.ts')}`);
    if (!definition || definition.provider !== providerKey) {
      throw new Error(`${packageId}: definition.provider mismatch`);
    }
    const manifest = JSON.parse(await readFile(path.join(pluginsDir, packageId, 'piwork.plugin.json'), 'utf8'));
    const output = {
      packageId,
      providerKey,
      version: manifest.version,
      name: definition.name,
      description: definition.description,
      baseUrl: definition.defaultBaseUrl,
      networkHosts: definition.networkHosts,
      validationModel: extras.validationModel,
      helpUrl: pick(definition.help?.url, 'zh-CN', 'en'),
      credentialFields: definition.credentialFields.map(field => ({
        variable: field.variable,
        type: field.type === 'secret-input' ? 'secret-input' : 'text-input',
        label: field.label,
        required: field.required === true,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      })),
      compat: extras.compat,
      models: definition.models.map(model => ({
        modelId: model.modelId,
        label: model.label,
        vision: model.features.vision === true,
        reasoning: model.features.reasoning === true,
        toolCall: model.features.toolCall === true,
        contextSize: model.properties.contextSize,
        defaultMaxTokens: model.properties.defaultMaxTokens,
      })),
    };
    const target = path.join(outDir, `${providerKey}.json`);
    await writeFile(target, JSON.stringify(output, null, 1) + '\n');
    console.log(`${packageId} → ${path.relative(desktopRoot, target)} (${output.models.length} models)`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
