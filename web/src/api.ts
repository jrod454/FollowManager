import { FollowInventoryResponse } from "./types";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError
} from "@supabase/supabase-js";
import { supabase } from "./supabase";

export class FollowApiError extends Error {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super(message);
    this.name = "FollowApiError";
    this.status = status;
  }
}

function parseFunctionErrorBody(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!("error" in value)) {
    return null;
  }

  const errorMessage = value.error;
  return typeof errorMessage === "string" ? errorMessage : null;
}

export async function fetchFollowInventory(): Promise<FollowInventoryResponse> {
  const functionName =
    import.meta.env.VITE_FOLLOW_MANAGER_SUPABASE_FUNCTION_NAME || "follow-manager";
  const { data, error } = await supabase.functions.invoke<FollowInventoryResponse>(
    functionName
  );

  if (error) {
    if (error instanceof FunctionsHttpError) {
      let errorMessage = "Failed to load follow inventory.";

      try {
        const body = await error.context.json();
        errorMessage = parseFunctionErrorBody(body) ?? errorMessage;
      } catch {
        // Keep default message.
      }

      throw new FollowApiError(errorMessage, error.context.status);
    }

    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      throw new FollowApiError("Unable to contact Supabase function.");
    }

    throw new FollowApiError("Failed to load follow inventory.");
  }

  if (!data) {
    throw new FollowApiError("Follow inventory response was empty.");
  }

  return data;
}
