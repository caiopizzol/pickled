import {
  type AnalysisReport,
  analyzeCitations,
  discoverCompetitors,
  extractProduct,
  fetchRepo,
  formatJSON,
  formatXML,
  generateTopics,
  printReport,
} from "@pickled-dev/core";
import chalk from "chalk";

export interface CheckOptions {
  json?: boolean;
  output?: string;
  verbose?: boolean;
  competitors?: string;
}

export async function check(
  repoUrl: string,
  options: CheckOptions,
): Promise<void> {
  const { json, output, verbose, competitors: competitorsArg } = options;

  const log = (msg: string) => !json && console.log(chalk.dim(msg));

  // 1. Fetch repo data
  log("🥒 Opening the jar...");
  const repoData = await fetchRepo(repoUrl);
  if (verbose) log(`   Found: ${repoData.repoUrl}`);

  // 2. Extract product info
  log("🔍 Checking what's inside...");
  const product = await extractProduct(repoData);
  if (verbose) log(`   ${product.name}: ${product.description}`);

  // 3. Discover competitors
  let competitors: string[];
  if (competitorsArg) {
    competitors = competitorsArg.split(",").map((c) => c.trim());
    log(`🫙 Using provided shelf mates: ${competitors.join(", ")}`);
  } else {
    log("🫙 Seeing who else is on the shelf...");
    competitors = await discoverCompetitors(product);
    if (verbose) log(`   Found: ${competitors.join(", ")}`);
  }

  // 4. Generate topics
  log("🏷️ Picking the right questions...");
  const topics = await generateTopics(product, competitors);
  if (verbose) {
    for (const t of topics)
      log(`   - ${t.name} (${t.questions.length} questions)`);
  }

  // 5. Run citation analysis
  log("📊 Checking your freshness...");
  const results = await analyzeCitations(
    product,
    competitors,
    topics,
    (msg) => {
      if (verbose) log(`   ${msg}`);
    },
  );

  // 6. Calculate summary
  const targetLower = product.name.toLowerCase();
  let totalMentions = 0;
  let totalQuestions = 0;
  let leadingTopics = 0;
  const opportunities: string[] = [];

  for (const result of results) {
    const targetStats = result.results[targetLower];
    totalMentions += targetStats?.mentions || 0;
    totalQuestions += targetStats?.total || 0;

    if (result.leader === targetLower) {
      leadingTopics++;
    } else {
      opportunities.push(result.topic);
    }
  }

  const report: AnalysisReport = {
    product,
    competitors,
    topics: results,
    summary: {
      overallVisibility:
        totalQuestions > 0
          ? Math.round((totalMentions / totalQuestions) * 100)
          : 0,
      totalMentions,
      totalQuestions,
      leadingTopics,
      totalTopics: results.length,
      opportunities,
    },
  };

  // 7. Output
  if (output) {
    const content = output.endsWith(".xml")
      ? formatXML(report)
      : formatJSON(report);
    await Bun.write(output, content);
    log(`\n🥒 Freshness report saved to ${output}`);
  } else if (json) {
    console.log(formatJSON(report));
  } else {
    printReport(report);
  }
}
