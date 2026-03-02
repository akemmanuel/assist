import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bundledLanguages, createHighlighterCore } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

let highlighterPromise: Promise<any> | null = null;
let highlighter: any | null = null;

function getHighlighter() {
  if (highlighter) return Promise.resolve(highlighter);
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = createHighlighterCore({
    themes: [
      import("@shikijs/themes/github-dark-default"),
      import("@shikijs/themes/github-light-default"),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).then((instance: any) => {
    highlighter = instance;
    return instance;
  });

  return highlighterPromise;
}

async function highlight(code: string, language: string, theme: string) {
  const instance = await getHighlighter();
  const lang = language || "text";

  if (
    lang !== "text" &&
    !instance.getLoadedLanguages().includes(lang) &&
    bundledLanguages[lang as keyof typeof bundledLanguages]
  ) {
    await instance.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);
  }

  const effectiveLang = instance.getLoadedLanguages().includes(lang) ? lang : "text";
  return instance.codeToHtml(code, { lang: effectiveLang, theme });
}

export function CodeBlock({ children }: { children: React.ReactNode }) {
  return <div className="my-3 overflow-hidden rounded-lg border border-border bg-card">{children}</div>;
}

export function CodeBlockCode({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const theme = useMemo(
    () => (document.documentElement.classList.contains("dark") ? "github-dark-default" : "github-light-default"),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    highlight(code, language, theme)
      .then(result => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    const observer = new MutationObserver(() => {
      const nextTheme = document.documentElement.classList.contains("dark")
        ? "github-dark-default"
        : "github-light-default";
      highlight(code, language, nextTheme)
        .then(result => {
          if (!cancelled) setHtml(result);
        })
        .catch(() => {
          if (!cancelled) setHtml(null);
        });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [code, language, theme]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-muted/70 px-3 py-1.5 text-xs text-muted-foreground">
        <span>{language || "text"}</span>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 hover:text-foreground">
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {html ? (
        <div
          className="overflow-x-auto p-3 text-sm [&>pre]:!m-0 [&>pre]:!bg-transparent [&>pre]:!p-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 text-sm">
          <code>{code}</code>
        </pre>
      )}
    </>
  );
}
