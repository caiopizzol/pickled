import chalk from "chalk";
import type { AnalysisReport, TopicResult } from "./types.js";

const LINE = "━".repeat(55);

function getFreshnessLabel(percentage: number): string {
  if (percentage >= 80) return chalk.green("Well Preserved 🥒");
  if (percentage >= 60) return chalk.green("Looking Fresh 🥒");
  if (percentage >= 40) return chalk.yellow("Going Stale ⚠️");
  return chalk.red("Starting to Spoil 🥒");
}

export function printReport(report: AnalysisReport): void {
  const { product, competitors, topics, summary } = report;

  console.log();
  console.log(chalk.bold(`🥒 Freshness Report: ${product.name}`));
  console.log(LINE);
  console.log();
  console.log(`📦 What's in the jar: ${product.name} - ${product.description}`);
  console.log(`🏷️  Domain: ${product.domain}`);
  console.log(`🫙 Who else is on the shelf: ${competitors.join(", ")}`);
  console.log();
  console.log(LINE);
  console.log(chalk.bold("📊 HOW FRESH ARE YOU?"));
  console.log(LINE);

  for (const topic of topics) {
    console.log();
    printTopic(topic, product.name);
  }

  console.log();
  console.log(LINE);
  console.log(chalk.bold("📈 FRESHNESS SUMMARY"));
  console.log(LINE);
  console.log();
  console.log(
    `Overall freshness: ${summary.overallVisibility}% - ${getFreshnessLabel(summary.overallVisibility)}`,
  );
  console.log(
    `Top of the shelf in: ${summary.leadingTopics}/${summary.totalTopics} topics`,
  );

  if (summary.opportunities.length > 0) {
    console.log(
      chalk.yellow(`Room to stay fresh: ${summary.opportunities.join(", ")}`),
    );
  }

  // Celebratory outro
  console.log();
  if (summary.overallVisibility >= 80) {
    console.log(chalk.green("🥒 You're kind of a big dill!"));
  }
  console.log(chalk.dim("Stay fresh! 🥒"));
  console.log();
}

function printTopic(topic: TopicResult, targetTool: string): void {
  const target = targetTool.toLowerCase();
  const isLeading = topic.leader === target;

  console.log(chalk.bold(`Topic: "${topic.topic}"`));

  const sorted = Object.entries(topic.results).sort(
    (a, b) => b[1].mentions - a[1].mentions,
  );

  for (let i = 0; i < sorted.length; i++) {
    const [tool, stats] = sorted[i];
    const isTarget = tool === target;
    const prefix =
      i === 0
        ? isTarget
          ? "  🥒"
          : "  ⚠️"
        : i === sorted.length - 1
          ? "  └─"
          : "  ├─";

    let line = `${prefix} ${tool}: ${stats.mentions}/${stats.total} (${stats.percentage}%)`;

    if (isTarget && isLeading) line += chalk.green(" - Well preserved!");
    else if (isTarget && !isLeading) line += chalk.yellow(" - Going stale");
    else if (i === 0 && !isTarget) line += chalk.dim(" ← Top of the shelf");

    console.log(line);

    if (isTarget && stats.contexts.length > 0) {
      const ctx = stats.contexts[0].slice(0, 50);
      console.log(chalk.dim(`  │  └─ "${ctx}..."`));
    }
  }
}

export function formatJSON(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatXML(report: AnalysisReport): string {
  const { product, topics, summary } = report;
  const target = product.name.toLowerCase();

  let failures = 0;
  const cases: string[] = [];

  for (const topic of topics) {
    const stats = topic.results[target];
    const isLeading = topic.leader === target;

    if (!isLeading) {
      failures++;
      const leaderStats = topic.results[topic.leader];
      cases.push(`    <testcase name="${esc(topic.topic)}" status="opportunity">
      <failure message="competitor ${esc(topic.leader)} leads with ${leaderStats?.percentage || 0}%"/>
      <visibility>${stats?.percentage || 0}%</visibility>
    </testcase>`);
    } else {
      cases.push(`    <testcase name="${esc(topic.topic)}" status="leading">
      <visibility>${stats?.percentage || 0}%</visibility>
    </testcase>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="pickled" tests="${topics.length}" failures="${failures}">
  <testsuite name="${esc(product.name)}" tests="${topics.length}" failures="${failures}">
    <properties>
      <property name="domain" value="${esc(product.domain)}"/>
      <property name="visibility" value="${summary.overallVisibility}%"/>
    </properties>
${cases.join("\n")}
  </testsuite>
</testsuites>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
