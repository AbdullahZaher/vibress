import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPublicationLocaleContextApi } from "./api/operations";

/** Shared per-session snapshot, always fetched through the scoped Admin API. */
export function usePublicationLocales() {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["publication", "locales"] });
    };
    window.addEventListener("vibress:locales-updated", refresh);
    return () => window.removeEventListener("vibress:locales-updated", refresh);
  }, [client]);
  return useQuery({
    queryKey: ["publication", "locales"],
    queryFn: getPublicationLocaleContextApi,
    staleTime: 60000,
    retry: false,
  });
}
