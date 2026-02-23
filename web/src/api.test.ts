import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFollowInventory, FollowApiError, mapRowsToFollowInventory } from "./api";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  supabase: {
    from: vi.fn()
  }
}));

type MockedSupabase = {
  from: ReturnType<typeof vi.fn>;
};

const mockedSupabase = supabase as unknown as MockedSupabase;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mapRowsToFollowInventory", () => {
  it("groups rows by destination channel and sorts names", () => {
    const payload = mapRowsToFollowInventory([
      {
        webhook_id: "hook-2",
        guild_id: "guild-1",
        guild_name: "Guild One",
        destination_channel_id: "dest-2",
        destination_channel_name: "z-updates",
        source_guild_id: "source-1",
        source_guild_name: "Source Guild",
        source_channel_id: "source-chan-2",
        source_channel_name: "Zulu",
        refreshed_at: "2026-02-23T12:00:00.000Z"
      },
      {
        webhook_id: "hook-1",
        guild_id: "guild-1",
        guild_name: "Guild One",
        destination_channel_id: "dest-1",
        destination_channel_name: "announcements",
        source_guild_id: "source-1",
        source_guild_name: "Source Guild",
        source_channel_id: "source-chan-1",
        source_channel_name: "Alpha",
        refreshed_at: "2026-02-23T11:00:00.000Z"
      }
    ]);

    expect(payload.guildId).toBe("guild-1");
    expect(payload.fetchedAt).toBe("2026-02-23T12:00:00.000Z");
    expect(payload.destinationChannels.map((group) => group.destinationChannelName)).toEqual([
      "announcements",
      "z-updates"
    ]);
    expect(payload.destinationChannels[0]?.follows[0]?.sourceChannelName).toBe("Alpha");
  });

  it("returns an empty snapshot payload when no rows exist", () => {
    const payload = mapRowsToFollowInventory([]);

    expect(payload.guildId).toBe("Unknown");
    expect(payload.fetchedAt).toBe("");
    expect(payload.destinationChannels).toEqual([]);
  });
});

describe("fetchFollowInventory", () => {
  it("queries the public follow inventory view", async () => {
    const select = vi.fn().mockResolvedValue({
      data: [
        {
          webhook_id: "hook-1",
          guild_id: "guild-1",
          guild_name: "Guild One",
          destination_channel_id: "dest-1",
          destination_channel_name: "announcements",
          source_guild_id: "source-1",
          source_guild_name: "Source Guild",
          source_channel_id: "source-chan-1",
          source_channel_name: "Alpha",
          refreshed_at: "2026-02-23T12:00:00.000Z"
        }
      ],
      error: null
    });

    mockedSupabase.from.mockReturnValue({ select });

    const payload = await fetchFollowInventory();

    expect(mockedSupabase.from).toHaveBeenCalledWith("follow_manager_inventory_public");
    expect(payload.destinationChannels).toHaveLength(1);
    expect(payload.destinationChannels[0]?.destinationChannelName).toBe("announcements");
  });

  it("throws a FollowApiError when query fails", async () => {
    const select = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "permission denied" }
    });

    mockedSupabase.from.mockReturnValue({ select });

    try {
      await fetchFollowInventory();
      throw new Error("Expected fetchFollowInventory to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(FollowApiError);
      expect(error).toMatchObject({
        message: "permission denied"
      });
    }
  });
});
