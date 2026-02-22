import { FormEvent, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { fetchFollowInventory, FollowApiError } from "./api";
import { supabase } from "./supabase";
import { DestinationChannelGroup, FollowInventoryResponse } from "./types";

function formatDateTime(value?: string): string {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

interface GuildGroup {
  sourceGuildId: string;
  sourceGuildName?: string;
  follows: Array<{
    destinationChannelId: string;
    destinationChannelName: string;
    sourceChannelName?: string;
    webhookId: string;
  }>;
}

function groupByGuild(groups: DestinationChannelGroup[]): GuildGroup[] {
  const map = new Map<string, GuildGroup>();
  for (const group of groups) {
    for (const follow of group.follows) {
      const key = follow.sourceGuildId ?? "unknown";
      if (!map.has(key)) {
        map.set(key, {
          sourceGuildId: key,
          sourceGuildName: follow.sourceGuildName,
          follows: []
        });
      }
      map.get(key)?.follows.push({
        destinationChannelId: group.destinationChannelId,
        destinationChannelName: group.destinationChannelName,
        sourceChannelName: follow.sourceChannelName,
        webhookId: follow.webhookId
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    (a.sourceGuildName ?? a.sourceGuildId).localeCompare(b.sourceGuildName ?? b.sourceGuildId)
  );
}

function filterGroups(
  groups: DestinationChannelGroup[],
  searchTerm: string
): DestinationChannelGroup[] {
  const normalizedTerm = searchTerm.trim().toLowerCase();
  if (!normalizedTerm) {
    return groups;
  }

  return groups
    .map((group) => {
      const destinationMatch = group.destinationChannelName
        .toLowerCase()
        .includes(normalizedTerm);
      const follows = group.follows.filter((follow) => {
        const sourceChannel = follow.sourceChannelName?.toLowerCase() ?? "";
        const sourceGuild = follow.sourceGuildName?.toLowerCase() ?? "";
        return sourceChannel.includes(normalizedTerm) || sourceGuild.includes(normalizedTerm);
      });

      if (destinationMatch) {
        return group;
      }

      if (follows.length > 0) {
        return { ...group, follows };
      }

      return null;
    })
    .filter((group): group is DestinationChannelGroup => group !== null);
}

interface SignInViewProps {
  busy: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}

function SignInView(props: SignInViewProps) {
  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={(event) => void props.onSubmit(event)}>
        <p className="eyebrow">Follow Manager</p>
        <h1>Sign In</h1>
        <p className="subheading">Use your Supabase account to access this dashboard.</p>

        <label className="search-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="search-input"
          value={props.email}
          onChange={(event) => props.onEmailChange(event.target.value)}
          required
        />

        <label className="search-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="search-input"
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          required
        />

        {props.error ? <section className="banner error">{props.error}</section> : null}

        <button className="refresh-button" type="submit" disabled={props.busy}>
          {props.busy ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [inventory, setInventory] = useState<FollowInventoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [view, setView] = useState<"guild" | "channel">("guild");

  useEffect(() => {
    let mounted = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) {
          return;
        }
        setSession(data.session);
      })
      .finally(() => {
        if (mounted) {
          setSessionLoading(false);
        }
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const visibleGroups = useMemo(
    () => filterGroups(inventory?.destinationChannels ?? [], search),
    [inventory, search]
  );
  const guildGroups = useMemo(() => groupByGuild(visibleGroups), [visibleGroups]);
  const totalFollows = useMemo(
    () => (inventory?.destinationChannels ?? []).reduce((acc, group) => acc + group.follows.length, 0),
    [inventory]
  );

  async function loadInventory(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchFollowInventory();
      setInventory(payload);
    } catch (caughtError) {
      if (caughtError instanceof FollowApiError) {
        setError(caughtError.message);
      } else {
        setError("Unable to load follow inventory.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session) {
      setInventory(null);
      return;
    }

    void loadInventory();
  }, [session]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (signInError) {
      setAuthError(signInError.message);
    } else {
      setPassword("");
    }
    setAuthBusy(false);
  }

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    setInventory(null);
    setSearch("");
    setError(null);
  }

  if (sessionLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="subheading">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <SignInView
        busy={authBusy}
        error={authError}
        onSubmit={handleSignIn}
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
      />
    );
  }

  return (
    <div className="page-shell">
      <main className="dashboard">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Discord Follow Inventory</p>
            <h1>Announcement Follow Overview</h1>
            <p className="subheading">
              Server: <strong>{inventory?.guildName ?? inventory?.guildId ?? "Unknown"}</strong>
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="refresh-button" onClick={() => void loadInventory()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="secondary-button" onClick={() => void handleSignOut()}>
              Sign Out
            </button>
          </div>
        </header>

        <section className="summary-grid">
          <article className="summary-card">
            <p className="summary-label">Last Updated</p>
            <p className="summary-value">{formatDateTime(inventory?.fetchedAt)}</p>
          </article>
          <article className="summary-card">
            <p className="summary-label">Destination Channels</p>
            <p className="summary-value">{inventory?.destinationChannels.length ?? 0}</p>
          </article>
          <article className="summary-card">
            <p className="summary-label">Total Follows</p>
            <p className="summary-value">{totalFollows}</p>
          </article>
          <article className="summary-card">
            <p className="summary-label">Account</p>
            <p className="summary-value">{session.user.email ?? session.user.id}</p>
          </article>
        </section>

        <section className="toolbar">
          <div className="view-toggle">
            <button
              type="button"
              className={`view-toggle-btn${view === "guild" ? " active" : ""}`}
              onClick={() => setView("guild")}
            >
              By Server
            </button>
            <button
              type="button"
              className={`view-toggle-btn${view === "channel" ? " active" : ""}`}
              onClick={() => setView("channel")}
            >
              By Channel
            </button>
          </div>
          <label className="search-label" htmlFor="search">
            Search by destination or source channel
          </label>
          <input
            id="search"
            name="search"
            className="search-input"
            type="text"
            placeholder="Try #announcements or source guild name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </section>

        {error ? <section className="banner error">{error}</section> : null}

        <section className="results">
          {view === "guild" ? (
            guildGroups.length === 0 ? (
              <div className="empty-state">No followed announcement channels found.</div>
            ) : (
              guildGroups.map((guild) => (
                <article className="channel-card" key={guild.sourceGuildId}>
                  <div className="channel-card-header">
                    <div>
                      <h3>{guild.sourceGuildName ?? "Unknown Guild"}</h3>
                      <p className="channel-id">{guild.sourceGuildId}</p>
                    </div>
                    <span className="follow-badge">{guild.follows.length}</span>
                  </div>
                  <ul>
                    {guild.follows.map((follow) => (
                      <li key={follow.webhookId}>
                        <span>#{follow.sourceChannelName ?? "unknown-channel"}</span>
                        <small>
                          {`-> #${follow.destinationChannelName} · ${follow.webhookId}`}
                        </small>
                      </li>
                    ))}
                  </ul>
                </article>
              ))
            )
          ) : visibleGroups.length === 0 ? (
            <div className="empty-state">No followed announcement channels found.</div>
          ) : (
            visibleGroups.map((group) => (
              <article className="channel-card" key={group.destinationChannelId}>
                <div className="channel-card-header">
                  <div>
                    <h3>#{group.destinationChannelName}</h3>
                    <p className="channel-id">{group.destinationChannelId}</p>
                  </div>
                  <span className="follow-badge">{group.follows.length}</span>
                </div>
                <ul>
                  {group.follows.map((follow) => (
                    <li key={follow.webhookId}>
                      <span>{follow.sourceGuildName ?? "Unknown Guild"}</span>
                      <small>
                        {`#${follow.sourceChannelName ?? "unknown-channel"} · ${follow.webhookId}`}
                      </small>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
