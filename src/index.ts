import { serve } from "bun";
import { createOpencodeClient } from "@opencode-ai/sdk";
import index from "./index.html";

type OpenCodeModel = {
  providerID: string;
  modelID: string;
};

const DEFAULT_OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";
let openCodeBaseUrl = DEFAULT_OPENCODE_BASE_URL;
let opencodeClient = createOpencodeClient({ baseUrl: openCodeBaseUrl });
const chatToSession = new Map<string, string>();

function setOpenCodeBaseUrl(nextBaseUrl: string) {
  openCodeBaseUrl = nextBaseUrl;
  opencodeClient = createOpencodeClient({ baseUrl: openCodeBaseUrl });
  chatToSession.clear();
}

function unwrap<T>(value: any): T {
  if (value && typeof value === "object" && "data" in value) {
    return value.data as T;
  }
  return value as T;
}

function extractSessionId(value: any): string | undefined {
  return (
    value?.id ??
    value?.sessionID ??
    value?.info?.sessionID ??
    value?.data?.id ??
    value?.data?.sessionID
  );
}

function extractTextFromParts(value: any): string {
  const payload = unwrap<any>(value);
  const parts: any[] = payload?.parts ?? payload?.info?.parts ?? [];
  const textParts = parts
    .filter(part => part?.type === "text" && typeof part?.text === "string")
    .map(part => part.text);
  return textParts.join("");
}

function normalizeProviderModels(provider: any): Array<{ id: string; name?: string }> {
  const raw = provider?.models;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((model: any) => {
        const id = model?.id ?? model?.modelID ?? model?.name;
        if (!id) return null;
        return { id, name: model?.name };
      })
      .filter(Boolean) as Array<{ id: string; name?: string }>;
  }

  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([key, model]: [string, any]) => {
        const id = model?.id ?? key;
        if (!id) return null;
        return { id, name: model?.name };
      })
      .filter(Boolean) as Array<{ id: string; name?: string }>;
  }

  return [];
}

async function getOrCreateSessionId(chatId: string) {
  const existing = chatToSession.get(chatId);
  if (existing) return existing;

  const created = await opencodeClient.session.create({ body: { title: "Assist Chat" } } as any);
  const createdPayload = unwrap<any>(created);
  const id = extractSessionId(createdPayload);
  if (!id) {
    throw new Error("Failed to create OpenCode session");
  }

  chatToSession.set(chatId, id);
  return id;
}

async function resolveModel(requestedModel?: OpenCodeModel) {
  if (requestedModel?.providerID && requestedModel?.modelID) {
    return requestedModel;
  }

  const providersRes = (await opencodeClient.config.providers()) as any;
  const providersPayload = unwrap<any>(providersRes) ?? {};
  const defaultChat = providersPayload?.default?.chat;

  if (typeof defaultChat === "string" && defaultChat.includes("/")) {
    const splitAt = defaultChat.indexOf("/");
    const providerID = defaultChat.slice(0, splitAt);
    const modelID = defaultChat.slice(splitAt + 1);
    if (providerID && modelID) {
      return { providerID, modelID };
    }
  }

  const providers = Array.isArray(providersPayload?.providers) ? providersPayload.providers : [];
  for (const provider of providers) {
    const providerID = provider?.id ?? provider?.providerID ?? provider?.name;
    const modelList = normalizeProviderModels(provider);
    const firstModel = modelList[0];
    const modelID = firstModel?.id;
    if (providerID && modelID) {
      return { providerID, modelID };
    }
  }

  throw new Error("No model available from OpenCode providers");
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function streamDeltasFromEventEndpoint(
  sessionId: string,
  onDelta: (delta: string) => void,
  onReasoning: (partId: string, text: string) => void,
  onTool: (part: any) => void,
  onStep: (part: any) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${openCodeBaseUrl}/event`, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to subscribe to OpenCode events: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const partTypeById = new Map<string, string>();
  const reasoningByPartId = new Map<string, string>();

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim());
      if (dataLines.length === 0) continue;

      const rawData = dataLines.join("\n");
      let event: any;
      try {
        event = JSON.parse(rawData);
      } catch {
        continue;
      }

      if (event?.type === "message.part.updated") {
        const part = event?.properties?.part;
        if (!part || part.sessionID !== sessionId) continue;

        if (typeof part.id === "string" && typeof part.type === "string") {
          partTypeById.set(part.id, part.type);
        }

        if (part.type === "reasoning" && typeof part.text === "string") {
          onReasoning(part.id, part.text);
          reasoningByPartId.set(part.id, part.text);
        }

        if (part.type === "tool") {
          onTool(part);
        }

        if (part.type === "step-start" || part.type === "step-finish") {
          onStep(part);
        }

        continue;
      }

      if (event?.type === "message.part.delta") {
        const props = event.properties ?? {};
        if (props.sessionID !== sessionId || props.field !== "text") continue;
        if (typeof props.delta === "string" && props.delta.length > 0) {
          const partId = typeof props.partID === "string" ? props.partID : "default";
          const partType = partTypeById.get(partId);

          if (partType === "reasoning") {
            const previous = reasoningByPartId.get(partId) ?? "";
            const next = previous + props.delta;
            reasoningByPartId.set(partId, next);
            onReasoning(partId, next);
            continue;
          }

          onDelta(props.delta);
        }
      }
    }
  }
}

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/ai/options": async () => {
      try {
        const [agentsRes, providersRes] = await Promise.all([
          opencodeClient.app.agents() as any,
          opencodeClient.config.providers() as any,
        ]);

        const agentsPayload = unwrap<any[]>(agentsRes) ?? [];
        const providersPayload = unwrap<any>(providersRes) ?? {};
        const providers = providersPayload?.providers ?? [];

        const models = providers.flatMap((provider: any) => {
          const providerID = provider?.id ?? provider?.providerID ?? provider?.name;
          const modelList = normalizeProviderModels(provider);
          return modelList
            .map((model: { id: string; name?: string }) => {
              const modelID = model.id;
              if (!providerID || !modelID) return null;
              return {
                providerID,
                modelID,
                label: model.name ? `${providerID}/${model.name}` : `${providerID}/${modelID}`,
              };
            })
            .filter(Boolean);
        });

        const defaultModel = providersPayload?.default?.chat;

        return Response.json({
          agents: agentsPayload.map((agent: any) => ({
            id: agent?.id ?? agent?.name,
            name: agent?.name ?? agent?.id,
          })),
          models,
          defaultModel,
        });
      } catch (error) {
        return Response.json(
          {
            error: "Failed to load AI options",
            details: String(error),
          },
          { status: 500 },
        );
      }
    },

    "/api/ai/config": {
      async GET() {
        return Response.json({
          baseUrl: openCodeBaseUrl,
          defaultBaseUrl: DEFAULT_OPENCODE_BASE_URL,
        });
      },
      async PUT(req) {
        const body = await req.json().catch(() => ({}));
        const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
        if (!baseUrl) {
          return Response.json({ error: "baseUrl is required" }, { status: 400 });
        }

        try {
          const parsed = new URL(baseUrl);
          if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
            return Response.json({ error: "baseUrl must use http or https" }, { status: 400 });
          }
        } catch {
          return Response.json({ error: "baseUrl must be a valid URL" }, { status: 400 });
        }

        setOpenCodeBaseUrl(baseUrl);
        return Response.json({ baseUrl: openCodeBaseUrl });
      },
    },

    "/api/chat/stream": {
      async POST(req) {
        const encoder = new TextEncoder();
        const body = await req.json().catch(() => ({}));
        const chatId = typeof body?.chatId === "string" ? body.chatId : "default";
        const message = typeof body?.message === "string" ? body.message.trim() : "";
        const agent = typeof body?.agent === "string" && body.agent.trim().length > 0 ? body.agent : undefined;
        const model = body?.model as OpenCodeModel | undefined;

        if (!message) {
          return Response.json({ error: "Message is required" }, { status: 400 });
        }

        const stream = new ReadableStream({
          async start(controller) {
            let sessionId = "";
            let fullText = "";

            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(sse(event, data)));
            };

            try {
              sessionId = await getOrCreateSessionId(chatId);
              send("ready", { sessionId });

              const eventAbort = new AbortController();

              const eventPromise = streamDeltasFromEventEndpoint(
                sessionId,
                delta => {
                  fullText += delta;
                  send("delta", { delta });
                },
                (partId, text) => {
                  send("reasoning", { partId, text });
                },
                part => {
                  send("tool", { part });
                },
                part => {
                  send("step", { part });
                },
                eventAbort.signal,
              );

              const resolvedModel = await resolveModel(model);

              const promptPromise = (opencodeClient.session.chat({
                path: { id: sessionId },
                body: {
                  providerID: resolvedModel.providerID,
                  modelID: resolvedModel.modelID,
                  agent,
                  parts: [{ type: "text", text: message }],
                },
              } as any) as Promise<any>)
                .then(response => {
                  const fallback = extractTextFromParts(response);
                  if (!fullText && fallback) {
                    fullText = fallback;
                    send("delta", { delta: fallback });
                  }
                })
                .finally(() => {
                  eventAbort.abort();
                });

              await promptPromise;
              await eventPromise.catch(() => {});
              send("done", { text: fullText, sessionId });
            } catch (error) {
              send("error", { message: String(error) });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
