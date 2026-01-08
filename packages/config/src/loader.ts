import YAML from "yaml";
import type { CheckConfig } from "./types.js";

export async function loadConfig(dir: string): Promise<CheckConfig> {
  const configPath = `${dir}/pickled.yml`;

  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`pickled.yml not found in ${dir}`);
  }

  try {
    const content = await file.text();
    return YAML.parse(content) as CheckConfig;
  } catch (error) {
    throw new Error(`Failed to parse pickled.yml: ${error}`);
  }
}
