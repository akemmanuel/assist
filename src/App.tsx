import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import { flushSync } from "react-dom";
import {
  Paperclip,
  Settings,
  ArrowUp,
  LoaderCircle,
  MessageSquarePlus,
  Lightbulb,
  Code,
  Pen,
  Globe,
  BookOpen,
  Utensils,
  Map,
  Music,
  Dumbbell,
  Mail,
  Calculator,
  Palette,
  Search,
  MessageCircle,
  Square,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import "./index.css";

// -- Theme --
type Theme = "dark" | "light";
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: "dark",
  toggleTheme: () => {},
});

function useTheme() {
  return useContext(ThemeContext);
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme") as Theme | null;
      if (stored === "light" || stored === "dark") return stored;
    }
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// -- Suggestion prompts --
type Suggestion = { icon: LucideIcon; label: string; prompt: string };

const ALL_SUGGESTIONS: Suggestion[] = [
  { icon: Lightbulb, label: "Brainstorm ideas", prompt: "Help me brainstorm creative ideas for a side project" },
  { icon: Code, label: "Debug my code", prompt: "Help me debug an issue in my code" },
  { icon: Pen, label: "Write an email", prompt: "Write a professional email for me" },
  { icon: Globe, label: "Translate text", prompt: "Translate the following text for me" },
  { icon: BookOpen, label: "Summarize a topic", prompt: "Give me a concise summary of a topic I'm researching" },
  { icon: Utensils, label: "Recipe ideas", prompt: "Suggest a quick and easy recipe for dinner tonight" },
  { icon: Map, label: "Plan a trip", prompt: "Help me plan a weekend trip itinerary" },
  { icon: Music, label: "Song recommendations", prompt: "Recommend some songs based on my mood" },
  { icon: Dumbbell, label: "Workout plan", prompt: "Create a simple workout routine I can do at home" },
  { icon: Mail, label: "Draft a message", prompt: "Help me draft a thoughtful message to a friend" },
  { icon: Calculator, label: "Explain a concept", prompt: "Explain a complex concept to me in simple terms" },
  { icon: Palette, label: "Design feedback", prompt: "Give me feedback on a design I'm working on" },
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  reasoning?: Array<{ id: string; text: string }>;
  toolCalls?: Array<{ id: string; label: string; status: string; order?: number }>;
};

function toDisplayText(value: unknown, fallback: string) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return fallback;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

type AgentOption = { id: string; name: string };
type ModelOption = { providerID: string; modelID: string; label: string };

type ModelSelection = { providerID: string; modelID: string };

type ConnectionForm = {
  baseUrl: string;
  username: string;
  password: string;
};

const CONNECTION_STORAGE_KEY = "opencode.connection";

function readStoredConnection(): ConnectionForm {
  if (typeof window === "undefined") {
    return { baseUrl: "", username: "", password: "" };
  }

  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return { baseUrl: "", username: "", password: "" };
    const parsed = JSON.parse(raw) as Partial<ConnectionForm>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      username: typeof parsed.username === "string" ? parsed.username : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
    };
  } catch {
    return { baseUrl: "", username: "", password: "" };
  }
}

function writeStoredConnection(value: ConnectionForm) {
  localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(value));
}

function encodeModelSelection(model: ModelSelection) {
  return JSON.stringify(model);
}

function decodeModelSelection(value: string): ModelSelection | undefined {
  const input = value.trim();
  if (!input) return undefined;

  if (input.startsWith("{")) {
    try {
      const parsed = JSON.parse(input) as Partial<ModelSelection>;
      if (typeof parsed.providerID === "string" && typeof parsed.modelID === "string") {
        return { providerID: parsed.providerID, modelID: parsed.modelID };
      }
    } catch {
      return undefined;
    }
  }

  const firstSlash = input.indexOf("/");
  if (firstSlash <= 0 || firstSlash >= input.length - 1) return undefined;

  return {
    providerID: input.slice(0, firstSlash),
    modelID: input.slice(firstSlash + 1),
  };
}

const USER_MSG_CLAMP_LINES = 8;

function MessageBubble({ message }: { message: ChatMessage }) {
  const [clamped, setClamped] = useState(true);
  const [needsClamp, setNeedsClamp] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || message.role !== "user") return;
    setNeedsClamp(el.scrollHeight > el.clientHeight + 1);
  }, [message.text, message.role]);

  if (message.role !== "user") {
    return (
      <div className="max-w-[85%] w-fit text-sm leading-relaxed break-words select-text mr-auto text-foreground space-y-2">
        <MarkdownRenderer content={message.text} />
        {(message.reasoning?.length ?? 0) > 0 && (
          <details className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">Reasoning</summary>
            <div className="mt-2 space-y-2">
              {message.reasoning?.map(item => (
                <div key={item.id} className="text-xs whitespace-pre-wrap text-muted-foreground">
                  {item.text}
                </div>
              ))}
            </div>
          </details>
        )}
        {(message.toolCalls?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            {[...(message.toolCalls ?? [])]
              .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
              .map(call => (
              <div key={call.id} className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
                <span className="font-medium">{call.label}</span>
                <span className="ml-2 text-muted-foreground">{call.status}</span>
              </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[85%] w-fit ml-auto flex flex-col items-end gap-1">
      <div
        ref={contentRef}
        className={`rounded-2xl px-3.5 py-2.5 bg-primary text-primary-foreground text-sm leading-relaxed whitespace-pre-wrap break-words select-text ${clamped ? `line-clamp-[${USER_MSG_CLAMP_LINES}]` : ""}`}
        style={clamped ? { display: "-webkit-box", WebkitLineClamp: USER_MSG_CLAMP_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
      >
        {message.text}
      </div>
      {needsClamp && (
        <button
          type="button"
          onClick={() => setClamped(prev => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
        >
          {clamped ? "Show more" : "Show less"}
        </button>
      )}
    </div>
  );
}

function ChatArea() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [connectionForm, setConnectionForm] = useState<ConnectionForm>({
    baseUrl: "",
    username: "",
    password: "",
  });
  const [isBootstrappingConnection, setIsBootstrappingConnection] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [connectionDetails, setConnectionDetails] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const [suggestions] = useState(() => pickRandom(ALL_SUGGESTIONS, 3));

  const canSend = useMemo(() => input.trim().length > 0 && !isStreaming && isConnected, [input, isStreaming, isConnected]);

  const loadAiOptions = useCallback(async () => {
    const storedAgent = localStorage.getItem("ai.agent") ?? "";
    const storedModel = localStorage.getItem("ai.model") ?? "";
    setSelectedAgent(storedAgent);
    setSelectedModel(storedModel);

    try {
      const optionsResponse = await fetch("/api/ai/options");

      if (!optionsResponse.ok) return;
      const data = await optionsResponse.json();
      const nextAgents: AgentOption[] = Array.isArray(data?.agents) ? data.agents : [];
      const nextModels: ModelOption[] = Array.isArray(data?.models) ? data.models : [];
      setAgents(nextAgents);
      setModels(nextModels);

      if (!storedAgent && nextAgents.length > 0) {
        const firstAgent = nextAgents.at(0);
        if (firstAgent) setSelectedAgent(firstAgent.id);
      }
      if (!storedModel && nextModels.length > 0) {
        const firstModel = nextModels.at(0);
        if (firstModel) setSelectedModel(encodeModelSelection(firstModel));
      }
    } catch {
      // Keep defaults if AI endpoints are unavailable.
    }
  }, []);

  const connectToServer = useCallback(
    async (nextForm: ConnectionForm, silent = false) => {
      setIsConnecting(true);
      if (!silent) {
        setConnectionStatus("");
        setConnectionDetails("");
      }

      try {
        const response = await fetch("/api/ai/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextForm),
        });
        const data = await response.json().catch(() => ({}));

        setConnectionForm({
          baseUrl: typeof data?.baseUrl === "string" ? data.baseUrl : nextForm.baseUrl,
          username: typeof data?.username === "string" ? data.username : nextForm.username,
          password: nextForm.password,
        });

        if (!response.ok) {
          setIsConnected(false);
          setConnectionStatus(data?.error ?? "Failed to connect to OpenCode");
          setConnectionDetails(data?.details ?? data?.lastError ?? "");
          return false;
        }

        writeStoredConnection({
          baseUrl: typeof data?.baseUrl === "string" ? data.baseUrl : nextForm.baseUrl,
          username: typeof data?.username === "string" ? data.username : nextForm.username,
          password: nextForm.password,
        });
        setIsConnected(true);
        setConnectionStatus("Connected");
        setConnectionDetails("");
        await loadAiOptions();
        return true;
      } catch (error) {
        setIsConnected(false);
        setConnectionStatus("Failed to connect to OpenCode");
        setConnectionDetails(String(error));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [loadAiOptions],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrapConnection = async () => {
      const stored = readStoredConnection();
      setConnectionForm(stored);

      try {
        const response = await fetch("/api/ai/config");
        const configData = await response.json().catch(() => ({}));

        if (cancelled) return;

        if (typeof configData?.baseUrl === "string" || typeof configData?.username === "string") {
          setConnectionForm(prev => ({
            baseUrl: prev.baseUrl || configData.baseUrl || "",
            username: prev.username || configData.username || "",
            password: prev.password,
          }));
        }

        if (configData?.connected) {
          setIsConnected(true);
          setConnectionStatus("Connected");
          setConnectionDetails("");
          await loadAiOptions();
          return;
        }

        if (stored.baseUrl) {
          await connectToServer(stored, true);
          return;
        }

        if (typeof configData?.lastError === "string" && configData.lastError !== "Not connected") {
          setConnectionStatus(configData.lastError);
        }
      } catch {
        if (stored.baseUrl) {
          await connectToServer(stored, true);
          return;
        }
      } finally {
        if (!cancelled) {
          setIsBootstrappingConnection(false);
        }
      }
    };

    bootstrapConnection();

    return () => {
      cancelled = true;
    };
  }, [connectToServer, loadAiOptions]);

  useEffect(() => {
    localStorage.setItem("ai.agent", selectedAgent);
  }, [selectedAgent]);

  useEffect(() => {
    localStorage.setItem("ai.model", selectedModel);
  }, [selectedModel]);

  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const onAssistantTriggered = () => {
      textareaRef.current?.focus();
    };
    window.addEventListener("assistantTriggered", onAssistantTriggered);
    return () => window.removeEventListener("assistantTriggered", onAssistantTriggered);
  }, []);

  const updateConnectionField = useCallback((field: keyof ConnectionForm, value: string) => {
    setConnectionForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const submitConnection = useCallback(async () => {
    const nextForm = {
      baseUrl: connectionForm.baseUrl.trim(),
      username: connectionForm.username.trim(),
      password: connectionForm.password,
    };
    setConnectionForm(nextForm);
    await connectToServer(nextForm);
  }, [connectToServer, connectionForm]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming || !isConnected) return;

    const assistantId = nextId.current + 1;

    const applyUpdate = () => {
      flushSync(() => {
        setMessages(prev => [
          ...prev,
          { id: nextId.current++, role: "user", text },
          { id: nextId.current++, role: "assistant", text: "", reasoning: [], toolCalls: [] },
        ]);
        setInput("");
      });
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      textareaRef.current?.focus();
    };

    if (messages.length === 0 && document.startViewTransition) {
      document.startViewTransition(applyUpdate);
    } else {
      applyUpdate();
    }

    const model = decodeModelSelection(selectedModel);

    const controller = new AbortController();
    streamAbortRef.current = controller;
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: "default",
          message: text,
          agent: selectedAgent || undefined,
          model,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Streaming request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const appendAssistant = (delta: string) => {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantId
              ? {
                  ...msg,
                  text: msg.text + delta,
                }
              : msg,
          ),
        );
      };

      const upsertReasoning = (partId: string, text: string) => {
        setMessages(prev =>
          prev.map(msg => {
            if (msg.id !== assistantId) return msg;
            const current = msg.reasoning ?? [];
            const index = current.findIndex(item => item.id === partId);
            if (index === -1) {
              return { ...msg, reasoning: [...current, { id: partId, text }] };
            }
            const next = [...current];
            next[index] = { id: partId, text };
            return { ...msg, reasoning: next };
          }),
        );
      };

      const upsertTool = (part: any) => {
        const partId = typeof part?.id === "string" ? part.id : crypto.randomUUID();
        const label = toDisplayText(part?.tool ?? part?.name ?? part?.call ?? part?.state?.title, "tool");
        const status = toDisplayText(part?.state?.status ?? part?.status, "running");
        setMessages(prev =>
          prev.map(msg => {
            if (msg.id !== assistantId) return msg;
            const current = msg.toolCalls ?? [];
            const index = current.findIndex(item => item.id === partId);
            if (index === -1) {
              return {
                ...msg,
                toolCalls: [...current, { id: partId, label, status, order: current.length + 1 }],
              };
            }
            const next = [...current];
            const existing = next[index];
            if (!existing) return msg;
            next[index] = { ...existing, id: existing.id ?? partId, label, status, order: existing.order ?? index + 1 };
            return { ...msg, toolCalls: next };
          }),
        );
      };

      const upsertStep = (part: any) => {
        const partId = typeof part?.id === "string" ? part.id : crypto.randomUUID();
        const isStart = part?.type === "step-start";
        const label = isStart ? "step" : "step done";
        const status = isStart ? "running" : "completed";

        setMessages(prev =>
          prev.map(msg => {
            if (msg.id !== assistantId) return msg;
            const current = msg.toolCalls ?? [];
            if (isStart) {
              return {
                ...msg,
                toolCalls: [...current, { id: partId, label, status, order: current.length + 1 }],
              };
            }

            const runningIndex = [...current]
              .reverse()
              .findIndex(item => item.label === "step" && item.status === "running");

            if (runningIndex !== -1) {
              const actualIndex = current.length - 1 - runningIndex;
              const next = [...current];
              const existing = next[actualIndex];
              if (!existing) return msg;
              next[actualIndex] = {
                ...existing,
                status: "completed",
                label: "step done",
                order: existing.order ?? actualIndex + 1,
              };
              return { ...msg, toolCalls: next };
            }

            return {
              ...msg,
              toolCalls: [...current, { id: partId, label, status, order: current.length + 1 }],
            };
          }),
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventBlock of events) {
          const lines = eventBlock.split("\n");
          const eventLine = lines.find(line => line.startsWith("event:"));
          const dataLines = lines.filter(line => line.startsWith("data:"));
          const eventName = eventLine?.slice(6).trim() ?? "message";
          if (dataLines.length === 0) continue;

          let payload: any;
          try {
            payload = JSON.parse(dataLines.map(line => line.slice(5).trim()).join("\n"));
          } catch {
            continue;
          }

          if (eventName === "delta" && typeof payload?.delta === "string") {
            appendAssistant(payload.delta);
          }
          if (eventName === "reasoning" && typeof payload?.partId === "string" && typeof payload?.text === "string") {
            upsertReasoning(payload.partId, payload.text);
          }
          if (eventName === "tool" && payload?.part) {
            upsertTool(payload.part);
          }
          if (eventName === "step" && payload?.part) {
            upsertStep(payload.part);
          }
          if (eventName === "error") {
            throw new Error(payload?.message ?? "Streaming failed");
          }
        }
      }
    } catch (error) {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantId
            ? {
                ...msg,
                text: `I hit an error while streaming the response.\n${String(error)}`,
              }
            : msg,
        ),
      );
    } finally {
      setIsStreaming(false);
      streamAbortRef.current = null;
    }
  };

  const onTextareaKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  };

  const { theme, toggleTheme } = useTheme();

  if (isBootstrappingConnection) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connecting to OpenCode</h1>
            <p className="text-sm text-muted-foreground">Assist checks your saved server connection before the app unlocks.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.16),_transparent_40%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.65))] px-4 py-6">
        <form
          onSubmit={event => {
            event.preventDefault();
            submitConnection();
          }}
          className="w-full max-w-md rounded-[2rem] border border-border/70 bg-card/95 p-6 shadow-2xl shadow-black/10 backdrop-blur"
        >
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Required Connection</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Connect to your OpenCode server</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Assist stays locked until it reaches OpenCode. Username and password are optional and only needed when the
              server uses Basic Auth.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="connect-base-url">OpenCode Base URL</Label>
              <Input
                id="connect-base-url"
                type="url"
                value={connectionForm.baseUrl}
                onChange={event => updateConnectionField("baseUrl", event.target.value)}
                placeholder="http://127.0.0.1:4096"
                autoComplete="url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connect-username">Username</Label>
              <Input
                id="connect-username"
                value={connectionForm.username}
                onChange={event => updateConnectionField("username", event.target.value)}
                placeholder="opencode"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connect-password">Password</Label>
              <Input
                id="connect-password"
                type="password"
                value={connectionForm.password}
                onChange={event => updateConnectionField("password", event.target.value)}
                placeholder="Optional"
                autoComplete="current-password"
              />
            </div>
          </div>

          {(connectionStatus || connectionDetails) && (
            <div className="mt-5 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm">
              {connectionStatus && <p className="font-medium text-foreground">{connectionStatus}</p>}
              {connectionDetails && <p className="mt-1 text-muted-foreground break-words">{connectionDetails}</p>}
            </div>
          )}

          <Button type="submit" className="mt-6 w-full" disabled={isConnecting || !connectionForm.baseUrl.trim()}>
            {isConnecting ? "Connecting..." : "Connect and open Assist"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* top bar */}
      <div className="shrink-0 flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <SidebarTrigger />
        <div className="flex-1" />
        <Dialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                  <Settings />
                  <span>Settings</span>
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <DialogContent className="sm:max-w-[26rem]">
            <DialogHeader>
              <DialogTitle className="text-lg">Settings</DialogTitle>
              <DialogDescription>Configure your chat preferences.</DialogDescription>
            </DialogHeader>

            <div className="space-y-6 pt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Appearance</p>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="dark-mode" className="flex flex-col items-start gap-0.5 cursor-pointer">
                    <span className="text-sm font-medium">Dark mode</span>
                    <span className="text-xs font-normal text-muted-foreground">Use dark theme across the app</span>
                  </Label>
                  <Switch id="dark-mode" checked={theme === "dark"} onCheckedChange={toggleTheme} />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">AI</p>
                <div className="space-y-3">
                  <Label htmlFor="base-url" className="text-sm font-medium">OpenCode Base URL</Label>
                  <Input
                    id="base-url"
                    type="url"
                    value={connectionForm.baseUrl}
                    onChange={event => updateConnectionField("baseUrl", event.target.value)}
                    placeholder="http://127.0.0.1:4096"
                    autoComplete="url"
                  />
                  <div className="space-y-2">
                    <Label htmlFor="settings-username" className="text-sm font-medium">Username</Label>
                    <Input
                      id="settings-username"
                      value={connectionForm.username}
                      onChange={event => updateConnectionField("username", event.target.value)}
                      placeholder="opencode"
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-password" className="text-sm font-medium">Password</Label>
                    <Input
                      id="settings-password"
                      type="password"
                      value={connectionForm.password}
                      onChange={event => updateConnectionField("password", event.target.value)}
                      placeholder="Optional"
                      autoComplete="current-password"
                    />
                  </div>
                  <Button type="button" onClick={submitConnection} disabled={isConnecting || !connectionForm.baseUrl.trim()}>
                    {isConnecting ? "Connecting..." : "Reconnect"}
                  </Button>
                  {(connectionStatus || connectionDetails) && (
                    <p className="text-xs text-muted-foreground break-words">
                      {connectionStatus}
                      {connectionDetails ? ` - ${connectionDetails}` : ""}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* message thread + composer wrapper */}
      <div className={`flex-1 flex flex-col min-h-0 ${messages.length === 0 ? "justify-center" : ""}`}>
        {messages.length > 0 && (
          <div
            ref={threadRef}
            className="flex-1 overflow-y-auto px-8 py-4 space-y-3 scroll-smooth"
            style={{ scrollbarWidth: "thin" }}
          >
            {messages.map(message => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}

        {/* empty state: greeting + suggestion pills */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-5 mb-4 px-4">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">Hi.</h1>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setInput(prompt);
                    textareaRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* composer */}
        <form
          ref={composerRef}
          onSubmit={event => {
            event.preventDefault();
            sendMessage();
          }}
          style={{ viewTransitionName: "composer" }}
          className="shrink-0 mx-4 mb-[max(0.5rem,env(safe-area-inset-bottom))] rounded-3xl border border-border bg-card flex flex-col overflow-hidden"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={event => {
              setInput(event.target.value);
              const el = event.target;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
            onKeyDown={onTextareaKeyDown}
            placeholder="Type a message..."
            className="w-full bg-transparent text-foreground placeholder:text-muted-foreground px-4 pt-3 pb-1 text-[0.9375rem] leading-relaxed resize-none outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-2 min-w-0">
              <select
                value={selectedAgent}
                onChange={event => setSelectedAgent(event.target.value)}
                className="h-8 max-w-28 rounded-full border border-border bg-background px-2 text-xs text-foreground outline-none"
              >
                <option value="">Default agent</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedModel}
                onChange={event => setSelectedModel(event.target.value)}
                className="h-8 max-w-40 rounded-full border border-border bg-background px-2 text-xs text-foreground outline-none"
              >
                <option value="">Default model</option>
                {models.map(model => {
                  const value = encodeModelSelection(model);
                  return (
                    <option key={value} value={value}>
                      {model.label}
                    </option>
                  );
                })}
              </select>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="rounded-full text-muted-foreground">
                    <Paperclip />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach file</TooltipContent>
              </Tooltip>
            </div>

            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                className="rounded-full"
                onClick={() => streamAbortRef.current?.abort()}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                className="rounded-full"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
    <TooltipProvider>
      <SidebarProvider defaultOpen={false} className="!min-h-0 h-svh">
        <Sidebar>
          <SidebarHeader className="p-3 space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2">
              <MessageSquarePlus className="size-4" />
              <span>New Chat</span>
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search chats..."
                className="w-full rounded-md border border-sidebar-border bg-transparent pl-8 pr-3 py-1.5 text-sm text-sidebar-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-sidebar-ring"
              />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Today</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton data-active="true">
                      <MessageCircle className="size-4" />
                      <span>Echo conversation</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Previous 7 days</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <MessageCircle className="size-4" />
                      <span>Hello world test</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <MessageCircle className="size-4" />
                      <span>Recipe suggestions</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <ChatArea />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
