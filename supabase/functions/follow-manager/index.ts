import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const FOLLOWER_WEBHOOK_TYPE = 2;
const DEFAULT_DISCORD_API_BASE_URL = "https://discord.com/api/v10";

interface FollowLink {
  webhookId: string;
  sourceGuildId?: string;
  sourceGuildName?: string;
  sourceChannelId?: string;
  sourceChannelName?: string;
}

interface DestinationChannelGroup {
  destinationChannelId: string;
  destinationChannelName: string;
  follows: FollowLink[];
}

interface FollowInventoryResponse {
  guildId: string;
  guildName?: string;
  fetchedAt: string;
  destinationChannels: DestinationChannelGroup[];
}

interface DiscordSourceChannel {
  id?: string;
  name?: string;
}

interface DiscordSourceGuild {
  id?: string;
  name?: string;
}

interface DiscordWebhook {
  id: string;
  type?: number;
  channel_id?: string;
  source_channel?: DiscordSourceChannel;
  source_guild?: DiscordSourceGuild;
}

interface DiscordGuildChannel {
  id: string;
  name: string;
}

interface DiscordGuild {
  id: string;
  name: string;
}

interface RuntimeConfig {
  discordBotToken: string;
  discordGuildId: string;
  discordApiBaseUrl: string;
  allowedUserIds: string[];
  allowedOrigins: string[];
}

interface DiscordRequestError {
  kind: "discord";
  status: number;
  path: string;
  responseBody?: string;
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function loadConfig():
  | { ok: true; value: RuntimeConfig }
  | { ok: false; message: string } {
  const discordBotToken =
    Deno.env.get("FOLLOW_MANAGER_DISCORD_BOT_TOKEN")?.trim() ?? "";
  const discordGuildId =
    Deno.env.get("FOLLOW_MANAGER_DISCORD_GUILD_ID")?.trim() ?? "";
  const discordApiBaseUrl =
    Deno.env.get("FOLLOW_MANAGER_DISCORD_API_BASE_URL")?.trim() ??
    DEFAULT_DISCORD_API_BASE_URL;
  const allowedUserIds = parseCsvEnv(
    Deno.env.get("FOLLOW_MANAGER_ALLOWED_USER_IDS")
  );
  const allowedOrigins = parseCsvEnv(
    Deno.env.get("FOLLOW_MANAGER_ALLOWED_ORIGINS")
  );

  if (!discordBotToken) {
    return {
      ok: false,
      message: "Missing FOLLOW_MANAGER_DISCORD_BOT_TOKEN."
    };
  }

  if (!discordGuildId) {
    return {
      ok: false,
      message: "Missing FOLLOW_MANAGER_DISCORD_GUILD_ID."
    };
  }

  if (allowedUserIds.length === 0) {
    return {
      ok: false,
      message: "Missing FOLLOW_MANAGER_ALLOWED_USER_IDS."
    };
  }

  return {
    ok: true,
    value: {
      discordBotToken,
      discordGuildId,
      discordApiBaseUrl,
      allowedUserIds,
      allowedOrigins
    }
  };
}

function compareLabel(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function toErrorResponse(
  message: string,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

function resolveAllowedOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[]
): string | null {
  const normalizedAllowedOrigins = allowedOrigins
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null);

  if (normalizedAllowedOrigins.length === 0) {
    return requestOrigin ?? "*";
  }

  if (normalizedAllowedOrigins.includes("*")) {
    return requestOrigin ?? "*";
  }

  if (!requestOrigin) {
    return normalizedAllowedOrigins[0] ?? null;
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (!normalizedRequestOrigin) {
    return null;
  }

  return normalizedAllowedOrigins.includes(normalizedRequestOrigin)
    ? requestOrigin
    : null;
}

function normalizeOrigin(originValue: string): string | null {
  const trimmed = originValue.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "*") {
    return "*";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function buildCorsHeaders(
  requestOrigin: string | null,
  allowedOrigins: string[]
): Record<string, string> {
  const resolvedOrigin = resolveAllowedOrigin(requestOrigin, allowedOrigins);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (resolvedOrigin) {
    headers["Access-Control-Allow-Origin"] = resolvedOrigin;
  }

  return headers;
}

async function requestDiscord<T>(
  baseUrl: string,
  token: string,
  path: string
): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const responseBody = await response.text();
    const error: DiscordRequestError = {
      kind: "discord",
      status: response.status,
      path,
      responseBody
    };
    throw error;
  }

  return (await response.json()) as T;
}

async function fetchInventory(config: RuntimeConfig): Promise<FollowInventoryResponse> {
  const guildId = config.discordGuildId;
  const [guild, webhooks, channels] = await Promise.all([
    requestDiscord<DiscordGuild>(
      config.discordApiBaseUrl,
      config.discordBotToken,
      `/guilds/${guildId}`
    ),
    requestDiscord<DiscordWebhook[]>(
      config.discordApiBaseUrl,
      config.discordBotToken,
      `/guilds/${guildId}/webhooks`
    ),
    requestDiscord<DiscordGuildChannel[]>(
      config.discordApiBaseUrl,
      config.discordBotToken,
      `/guilds/${guildId}/channels`
    )
  ]);

  const destinationNames = new Map<string, string>();
  for (const channel of channels) {
    destinationNames.set(channel.id, channel.name);
  }

  const grouped = new Map<string, DestinationChannelGroup>();

  for (const webhook of webhooks) {
    if (webhook.type !== FOLLOWER_WEBHOOK_TYPE) {
      continue;
    }

    const destinationChannelId = webhook.channel_id ?? "unknown";
    const destinationChannelName =
      destinationNames.get(destinationChannelId) ??
      `Unknown Destination (${destinationChannelId})`;

    if (!grouped.has(destinationChannelId)) {
      grouped.set(destinationChannelId, {
        destinationChannelId,
        destinationChannelName,
        follows: []
      });
    }

    grouped.get(destinationChannelId)?.follows.push({
      webhookId: webhook.id,
      sourceGuildId: webhook.source_guild?.id,
      sourceGuildName: webhook.source_guild?.name ?? "Unknown Source Guild",
      sourceChannelId: webhook.source_channel?.id,
      sourceChannelName: webhook.source_channel?.name ?? "Unknown Source Channel"
    });
  }

  const destinationChannels = [...grouped.values()];
  destinationChannels.sort((left, right) =>
    compareLabel(left.destinationChannelName, right.destinationChannelName)
  );

  for (const group of destinationChannels) {
    group.follows.sort((left, right) =>
      compareLabel(
        left.sourceChannelName ?? left.sourceChannelId ?? "",
        right.sourceChannelName ?? right.sourceChannelId ?? ""
      )
    );
  }

  return {
    guildId,
    guildName: guild.name,
    fetchedAt: new Date().toISOString(),
    destinationChannels
  };
}

function mapDiscordError(error: DiscordRequestError): { message: string; status: number } {
  if (error.status === 401 || error.status === 403 || error.status === 404) {
    return {
      status: 400,
      message:
        "Discord access failed. Verify FOLLOW_MANAGER_DISCORD_BOT_TOKEN, FOLLOW_MANAGER_DISCORD_GUILD_ID, and bot permissions."
    };
  }

  if (error.status === 429) {
    return {
      status: 429,
      message: "Discord rate limit reached. Retry shortly."
    };
  }

  return {
    status: 502,
    message: `Discord API error (${error.status}).`
  };
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get("Origin");
  const configResult = loadConfig();
  const allowedOrigins = configResult.ok ? configResult.value.allowedOrigins : [];
  const corsHeaders = buildCorsHeaders(requestOrigin, allowedOrigins);

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (request.method !== "POST") {
    return toErrorResponse("Method not allowed.", 405, corsHeaders);
  }

  if (requestOrigin && resolveAllowedOrigin(requestOrigin, allowedOrigins) === null) {
    return toErrorResponse("Origin is not allowed.", 403, corsHeaders);
  }

  if (!configResult.ok) {
    return toErrorResponse(configResult.message, 400, corsHeaders);
  }

  const config = configResult.value;
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return toErrorResponse("Missing bearer token.", 401, corsHeaders);
  }

  const supabaseUrl = Deno.env.get("VITE_FOLLOW_MANAGER_SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return toErrorResponse(
      "Missing VITE_FOLLOW_MANAGER_SUPABASE_URL or VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY.",
      500,
      corsHeaders
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return toErrorResponse("Unauthorized.", 401, corsHeaders);
  }

  if (!config.allowedUserIds.includes(user.id)) {
    return toErrorResponse("Forbidden.", 403, corsHeaders);
  }

  try {
    const payload = await fetchInventory(config);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error) {
      const mapped = mapDiscordError(error as DiscordRequestError);
      return toErrorResponse(mapped.message, mapped.status, corsHeaders);
    }

    return toErrorResponse(
      "Unexpected error while loading follow inventory.",
      502,
      corsHeaders
    );
  }
});
