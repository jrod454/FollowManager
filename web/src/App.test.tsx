import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { fetchFollowInventory } from "./api";
import { supabase } from "./supabase";

vi.mock("./api", () => ({
  fetchFollowInventory: vi.fn()
}));

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn()
    }
  }
}));

type MockedAuth = {
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

const mockedFetchFollowInventory = vi.mocked(fetchFollowInventory);
const mockedAuth = (supabase as unknown as { auth: MockedAuth }).auth;

const SESSION = {
  user: {
    id: "user-1",
    email: "owner@example.com"
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.onAuthStateChange.mockReturnValue({
    data: {
      subscription: { unsubscribe: vi.fn() }
    }
  });
  mockedAuth.signInWithPassword.mockResolvedValue({ error: null });
  mockedAuth.signOut.mockResolvedValue({ error: null });
});

describe("App", () => {
  it("shows sign in form when there is no session", async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: null }
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("renders inventory for authenticated users", async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: SESSION }
    });
    mockedFetchFollowInventory.mockResolvedValue({
      guildId: "guild-1",
      guildName: "Guild One",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      destinationChannels: [
        {
          destinationChannelId: "dest-1",
          destinationChannelName: "news",
          follows: [
            {
              webhookId: "hook-1",
              sourceGuildId: "source-guild-1",
              sourceGuildName: "Source Guild",
              sourceChannelName: "Announcements A"
            }
          ]
        }
      ]
    });

    render(<App />);

    expect(await screen.findByText("Source Guild")).toBeInTheDocument();
    expect(screen.getByText("#Announcements A")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  });

  it("refreshes by requesting inventory again", async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: SESSION }
    });
    mockedFetchFollowInventory.mockResolvedValue({
      guildId: "guild-1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      destinationChannels: []
    });

    render(<App />);

    await waitFor(() => expect(mockedFetchFollowInventory).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(mockedFetchFollowInventory).toHaveBeenCalledTimes(2));
    expect(mockedFetchFollowInventory.mock.calls[1]).toEqual([]);
  });

  it("signs in with email and password", async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: null }
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Sign In" });

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw123456");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(mockedAuth.signInWithPassword).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "pw123456"
      })
    );
  });
});
