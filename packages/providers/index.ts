/// <reference path="./types.d.ts" />

import tfRouterLanguage from "./src/language/tfRouter";
import deepSeek from "./src/language/deepSeek";
import claudeCode from "./src/language/claudeCode";
import codex from "./src/language/codex";
import tfRouterMedia from "./src/media/tfRouter";

export type Provider = ProviderDefinition;
export type ProviderTools = ProviderContext["tool"];
export type AudioConvertOptions = Parameters<ProviderTools["audio"]["convert"]>[1];
export type { FfmpegFactory, FfmpegCommand } from "@toonflow/ffmpeg/types";

export const languageProviders: ProviderDefinition[] = [tfRouterLanguage, deepSeek, claudeCode, codex];
export const mediaProviders = [tfRouterMedia] as const;
