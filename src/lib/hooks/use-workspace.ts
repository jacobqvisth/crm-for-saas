"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/database.types";
import React from "react";

type Workspace = Tables<"workspaces">;

interface WorkspaceContextValue {
  workspace: Workspace | null;
  workspaceId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  workspaceId: null,
  loading: true,
  error: null,
  refresh: async () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const loadWorkspace = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not authenticated");
        return;
      }

      const { data: memberships, error: memberError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .limit(1);

      if (memberError) {
        setError(memberError.message);
        return;
      }

      if (!memberships || memberships.length === 0) {
        setError("No workspace found");
        return;
      }

      const { data: ws, error: wsError } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", memberships[0].workspace_id)
        .single();

      if (wsError) {
        setError(wsError.message);
        return;
      }

      setWorkspace(ws);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  return React.createElement(
    WorkspaceContext.Provider,
    {
      value: {
        workspace,
        workspaceId: workspace?.id ?? null,
        loading,
        error,
        refresh: loadWorkspace,
      },
    },
    children
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}
