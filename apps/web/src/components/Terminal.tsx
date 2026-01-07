import type { ReactNode } from "react";
import "./Terminal.css";

interface TerminalProps {
  children: ReactNode;
}

export function Terminal({ children }: TerminalProps) {
  return (
    <div className="terminal">
      <div className="terminal-header">
        <span className="terminal-dot"></span>
        <span className="terminal-dot"></span>
        <span className="terminal-dot"></span>
      </div>
      <div className="terminal-body">{children}</div>
    </div>
  );
}

interface TerminalLineProps {
  children: ReactNode;
}

export function TerminalLine({ children }: TerminalLineProps) {
  return <div className="terminal-line">{children}</div>;
}

// Helper components for syntax highlighting
export const T = {
  Prompt: ({ children }: { children: ReactNode }) => (
    <span className="prompt">{children}</span>
  ),
  Cmd: ({ children }: { children: ReactNode }) => (
    <span className="cmd">{children}</span>
  ),
  Output: ({ children }: { children: ReactNode }) => (
    <span className="output">{children}</span>
  ),
  Success: ({ children }: { children: ReactNode }) => (
    <span className="success">{children}</span>
  ),
  Warning: ({ children }: { children: ReactNode }) => (
    <span className="warning">{children}</span>
  ),
  Error: ({ children }: { children: ReactNode }) => (
    <span className="error">{children}</span>
  ),
  Highlight: ({ children }: { children: ReactNode }) => (
    <span className="highlight">{children}</span>
  ),
};
