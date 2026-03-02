import "katex/dist/katex.min.css";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";

const markdownComponents = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode; [key: string]: unknown }) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const code = String(children).replace(/\n$/, "");
    const isBlock = !!language;

    if (isBlock) {
      return (
        <CodeBlock>
          <CodeBlockCode code={code} language={language} />
        </CodeBlock>
      );
    }

    return (
      <code
        className={cn(
          "rounded bg-muted px-[0.3rem] py-[0.1rem] font-mono text-[0.85em] font-medium",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead className="border-b border-border bg-muted/50">{children}</thead>;
  },
  th({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) {
    return (
      <td className="border-t border-border px-3 py-2 text-sm" {...props}>
        {children}
      </td>
    );
  },
  a({ children, href, ...props }: { children?: React.ReactNode; href?: string; [key: string]: unknown }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" {...props}>
        {children}
      </a>
    );
  },
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [[rehypeKatex, { strict: true }]];

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  const cleanedContent = content
    .replace(/(\$\$[^$]+\$\$|\$(?!\s)([^\n$]+?)(?<!\s)\$)/g, match => match.replace(/!/g, "\\!"))
    .replace(/(```[\s\S]*?```|`[^`\n]+`)|( - )/g, (match, codeBlock, dashSpace) => {
      if (codeBlock) return codeBlock;
      if (dashSpace) return " -";
      return match;
    });

  return (
    <div className="markdown-renderer prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none select-text">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as any}
        components={markdownComponents as Record<string, React.ComponentType<any>>}
      >
        {cleanedContent}
      </ReactMarkdown>
    </div>
  );
});
