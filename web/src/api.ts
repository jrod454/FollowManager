import { FollowInventoryResponse } from "./types";
import { supabase } from "./supabase";

export class FollowApiError extends Error {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super(message);
    this.name = "FollowApiError";
    this.status = status;
  }
}

interface FollowInventoryRow {
  webhook_id: string;
  guild_id: string;
  guild_name: string | null;
  destination_channel_id: string;
  destination_channel_name: string;
  source_guild_id: string | null;
  source_guild_name: string | null;
  source_channel_id: string | null;
  source_channel_name: string | null;
  refreshed_at: string;
}

function compareLabel(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function resolveFetchedAt(rows: FollowInventoryRow[]): string {
  let latest = "";
  for (const row of rows) {
    const refreshedAt = row.refreshed_at ?? "";
    if (!refreshedAt) {
      continue;
    }
    if (!latest || refreshedAt > latest) {
      latest = refreshedAt;
    }
  }
  return latest;
}

export function mapRowsToFollowInventory(rows: FollowInventoryRow[]): FollowInventoryResponse {
  const destinationChannelMap = new Map<
    string,
    FollowInventoryResponse["destinationChannels"][number]
  >();

  for (const row of rows) {
    if (!destinationChannelMap.has(row.destination_channel_id)) {
      destinationChannelMap.set(row.destination_channel_id, {
        destinationChannelId: row.destination_channel_id,
        destinationChannelName: row.destination_channel_name,
        follows: []
      });
    }

    destinationChannelMap.get(row.destination_channel_id)?.follows.push({
      webhookId: row.webhook_id,
      sourceGuildId: row.source_guild_id ?? undefined,
      sourceGuildName: row.source_guild_name ?? undefined,
      sourceChannelId: row.source_channel_id ?? undefined,
      sourceChannelName: row.source_channel_name ?? undefined
    });
  }

  const destinationChannels = Array.from(destinationChannelMap.values());
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
    guildId: rows[0]?.guild_id ?? "Unknown",
    guildName: rows[0]?.guild_name ?? undefined,
    fetchedAt: resolveFetchedAt(rows),
    destinationChannels
  };
}

export async function fetchFollowInventory(): Promise<FollowInventoryResponse> {
  const { data, error } = await supabase
    .from("follow_manager_inventory_public")
    .select(
      "webhook_id,guild_id,guild_name,destination_channel_id,destination_channel_name,source_guild_id,source_guild_name,source_channel_id,source_channel_name,refreshed_at"
    );

  if (error) {
    throw new FollowApiError(error.message || "Failed to load follow inventory.");
  }

  return mapRowsToFollowInventory((data ?? []) as FollowInventoryRow[]);
}
