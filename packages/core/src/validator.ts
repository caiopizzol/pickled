export function validateScenario(response: string, toolName: string): boolean {
  const regex = new RegExp(`\\b${escapeRegex(toolName)}\\b`, "gi");
  return regex.test(response);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
