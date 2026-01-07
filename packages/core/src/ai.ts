import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red("🥒 Something went sour."));
    console.error();
    console.error("   Missing API key for the AI.");
    console.error(chalk.dim("   Get one at: https://console.anthropic.com/"));
    process.exit(1);
  }
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export async function askClaude(prompt: string): Promise<string> {
  const anthropic = getClient();

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    return message.content[0].type === "text" ? message.content[0].text : "";
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error(chalk.red("🥒 That API key's gone bad. Double-check it?"));
      process.exit(1);
    }
    if (error instanceof Anthropic.RateLimitError) {
      console.error(chalk.yellow("⏳ Brine time... AI needs a breather (10s)"));
      await Bun.sleep(10000);
      return askClaude(prompt);
    }
    throw error;
  }
}

export async function askClaudeJSON<T>(prompt: string): Promise<T> {
  const response = await askClaude(
    `${prompt}\n\nRespond ONLY with valid JSON, no markdown.`,
  );

  let json = response.trim();
  if (json.startsWith("```")) {
    json = json
      .replace(/```json?\n?/g, "")
      .replace(/```$/g, "")
      .trim();
  }

  return JSON.parse(json) as T;
}
