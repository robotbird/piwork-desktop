import deepseek from './catalog/deepseek.json';
import tongyi from './catalog/tongyi.json';
import zhipuai from './catalog/zhipuai.json';
import type {ProviderCatalogItem,ProviderDefinition} from '../../shared/types';
import {validateProviderDefinition} from './store';

/** 内置供应商目录:JSON 由 scripts/export-model-catalog.mjs 从 piwork web 仓库
    plugins 下 piwork-llm-* 插件包的声明式数据生成(更新插件后重跑脚本并核对 compat 表)。 */
const definitions=[deepseek,tongyi,zhipuai].map(entry=>validateProviderDefinition(entry));

export const builtinCatalog:readonly ProviderDefinition[]=definitions;

/** 目录视图:installed 标记按 providerKey 对齐已安装项 */
export function catalogView(installedKeys:ReadonlySet<string>):ProviderCatalogItem[]{
 return definitions.map(definition=>({...definition,installed:installedKeys.has(definition.providerKey)}));
}
