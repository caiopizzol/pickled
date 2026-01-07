export interface ProductInfo {
  name: string;
  description: string;
  domain: string;
  language: string;
  url: string;
}

export interface RepoData {
  readme: string;
  packageJson: Record<string, unknown> | null;
  repoUrl: string;
  owner: string;
  repo: string;
}

export interface Topic {
  name: string;
  questions: string[];
}

export interface ToolMentions {
  mentions: number;
  total: number;
  percentage: number;
  contexts: string[];
}

export interface TopicResult {
  topic: string;
  results: Record<string, ToolMentions>;
  leader: string;
}

export interface AnalysisReport {
  product: ProductInfo;
  competitors: string[];
  topics: TopicResult[];
  summary: {
    overallVisibility: number;
    totalMentions: number;
    totalQuestions: number;
    leadingTopics: number;
    totalTopics: number;
    opportunities: string[];
  };
}
