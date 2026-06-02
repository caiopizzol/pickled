import { describe, expect, test } from "bun:test";
import {
  assertEditCapable,
  isEditCapable,
} from "../../src/targets/capabilities.js";

describe("isEditCapable", () => {
  test("CLI coding agents are edit-capable", () => {
    expect(isEditCapable({ category: "cli", provider: "claude-code" })).toBe(
      true,
    );
    expect(isEditCapable({ category: "cli", provider: "codex-cli" })).toBe(
      true,
    );
  });

  test("API providers are not edit-capable", () => {
    expect(isEditCapable({ category: "api", provider: "anthropic" })).toBe(
      false,
    );
    expect(isEditCapable({ category: "api", provider: "openai" })).toBe(false);
  });

  test("an unimplemented CLI provider is not edit-capable", () => {
    expect(isEditCapable({ category: "cli", provider: "amazon-q" })).toBe(
      false,
    );
  });
});

describe("assertEditCapable", () => {
  test("passes for an edit-capable agent", () => {
    expect(() =>
      assertEditCapable("builder", {
        category: "cli",
        provider: "claude-code",
      }),
    ).not.toThrow();
  });

  test("throws for an API agent", () => {
    expect(() =>
      assertEditCapable("api_reader", { category: "api", provider: "openai" }),
    ).toThrow(/cannot run build tasks/);
  });
});
