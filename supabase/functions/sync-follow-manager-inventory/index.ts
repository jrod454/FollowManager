import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const FOLLOWER_WEBHOOK_TYPE = 2;
const DEFAULT_DISCORD_API_BASE_URL = "https://discord.com/api/v10";

interface RuntimeConfig {
  discordBotToken: string;
  discordGuildId: string;
  discordApiBaseUrl: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

interface DiscordRequestError {
  kind: "discord";
  status: number;
  path: string;
  responseBody?: string;
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

interface FollowManagerInventoryRow {
  webhook_id: string;
  guild_id: string;
  guild_name: string | null;
  destination_channel_id: string;
  destination_channel_name: string;
  source_guild_id: string | null;
  source_guild_name: string | null;
  source_channel_id: string | null;
  source_channel_name: string | null;
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const supabaseServiceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

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

  if (!supabaseUrl) {
    return {
      ok: false,
      message: "Missing SUPABASE_URL."
    };
  }

  if (!supabaseServiceRoleKey) {
    return {
      ok: false,
      message: "Missing SUPABASE_SERVICE_ROLE_KEY."
    };
  }

  return {
    ok: true,
    value: {
      discordBotToken,
      discordGuildId,
      discordApiBaseUrl,
      supabaseUrl,
      supabaseServiceRoleKey
    }
  };
}

function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length);
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const payloadSegment = segments[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segments[1].length / 4) * 4, "=");
    const payload = JSON.parse(atob(payloadSegment)) as { role?: string };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function toJsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
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

async function fetchSnapshotRows(
  config: RuntimeConfig
): Promise<{
  rows: FollowManagerInventoryRow[];
  guildId: string;
}> {
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

  const rows: FollowManagerInventoryRow[] = [];

  for (const webhook of webhooks) {
    if (webhook.type !== FOLLOWER_WEBHOOK_TYPE) {
      continue;
    }

    const destinationChannelId = webhook.channel_id ?? "unknown";
    const destinationChannelName =
      destinationNames.get(destinationChannelId) ??
      `Unknown Destination (${destinationChannelId})`;

    rows.push({
      webhook_id: webhook.id,
      guild_id: guildId,
      guild_name: guild.name ?? null,
      destination_channel_id: destinationChannelId,
      destination_channel_name: destinationChannelName,
      source_guild_id: webhook.source_guild?.id ?? null,
      source_guild_name: webhook.source_guild?.name ?? "Unknown Source Guild",
      source_channel_id: webhook.source_channel?.id ?? null,
      source_channel_name: webhook.source_channel?.name ?? "Unknown Source Channel"
    });
  }

  return {
    rows,
    guildId
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
  if (request.method !== "POST") {
    return toJsonResponse({ error: "Method not allowed." }, 405);
  }

  const jwtRole = decodeJwtRole(request.headers.get("Authorization"));
  if (jwtRole !== "service_role") {
    return toJsonResponse({ error: "Forbidden." }, 403);
  }

  const configResult = loadConfig();
  if (!configResult.ok) {
    return toJsonResponse({ error: configResult.message }, 500);
  }

  const config = configResult.value;
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  try {
    const { rows, guildId } = await fetchSnapshotRows(config);
    const refreshedAt = new Date().toISOString();

    const { data, error } = await supabase.rpc("follow_manager_replace_inventory", {
      snapshot_rows: rows,
      snapshot_refreshed_at: refreshedAt
    });

    if (error) {
      return toJsonResponse(
        {
          error: "Failed to replace follow inventory snapshot.",
          details: error.message
        },
        500
      );
    }

    return toJsonResponse(
      {
        guildId,
        rowCount: typeof data === "number" ? data : rows.length,
        refreshedAt
      },
      200
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error) {
      const mapped = mapDiscordError(error as DiscordRequestError);
      return toJsonResponse({ error: mapped.message }, mapped.status);
    }

    return toJsonResponse({ error: "Unexpected sync failure." }, 502);
  }
});
