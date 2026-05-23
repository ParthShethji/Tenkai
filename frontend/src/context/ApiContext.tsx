import React, { createContext, useContext, useState, useMemo, useEffect, ReactNode } from "react";
import { createApiClient, type ApiClient } from "../api";

const API_TOKEN_KEY = "agentfi-api-token";

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_BASE_URL;
  if (url && typeof url === "string") return url.replace(/\/$/, "");
  return "http://localhost:3000";
}

interface ApiContextType {
  api: ApiClient;
  token: string;
  setToken: (t: string) => void;
  baseUrl: string;
}

const ApiContext = createContext<ApiContextType | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const baseUrl = useMemo(() => getBaseUrl(), []);
  const [token, setTokenState] = useState<string>(() => {
    return localStorage.getItem(API_TOKEN_KEY) || "";
  });

  useEffect(() => {
    if (token) {
      localStorage.setItem(API_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(API_TOKEN_KEY);
    }
  }, [token]);

  const setToken = (t: string) => setTokenState(t ?? "");

  const api = useMemo(() => createApiClient(baseUrl, token), [baseUrl, token]);

  const value = useMemo(
    () => ({
      api,
      token,
      setToken,
      baseUrl,
    }),
    [api, token, baseUrl]
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within ApiProvider");
  return ctx;
}
